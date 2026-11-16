(function(){
  var API="/api/santa";
  var SITE="https://garage-secret-santa.netlify.app/";
  var $=function(id){return document.getElementById(id)};
  var state=null, me=null, busy=false;
  var ls={get:function(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del:function(k){try{localStorage.removeItem(k)}catch(e){}}};
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]})}
  function toast(m){var t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove("on")},2600)}
  function api(body){
    var opt=body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"};
    return fetch(API,opt).then(function(r){return r.json().catch(function(){return {error:"Unexpected reply"}}).then(function(j){j._status=r.status;return j})})
      .catch(function(){return {error:"Can't reach the North Pole. Check your connection and try again.",_status:0}});
  }
  function shareUrl(){return location.origin+"/"}
  function myLink(t){return location.origin+"/?me="+t}
  function claim(){return ls.get("gs-santa-claim")}
  function organiser(){return state&&state.organiser?state.organiser:"the organiser"}

  /* ---------- lights ---------- */
  function drawLights(){
    var svg=$("lights"),w=window.innerWidth,n=Math.max(8,Math.round(w/70)),cols=["#FFC700","#FA4261","#FFF8DB","#4CB838"],h="";
    var path="M0 8";for(var i=0;i<=n;i++){var x=i*w/n;path+=" Q"+(x-w/n/2)+" 34 "+x+" 8"}
    h+='<path d="'+path+'" stroke="#0f2228" stroke-width="2.5" fill="none"/>';
    for(var j=0;j<n;j++){var bx=(j+.5)*w/n,c=cols[j%cols.length];
      h+='<g><rect x="'+(bx-4)+'" y="19" width="8" height="7" rx="2" fill="#0f2228"/><ellipse class="bulb" style="animation-delay:'+(j*0.37%2.4).toFixed(2)+'s" cx="'+bx+'" cy="36" rx="7" ry="11" fill="'+c+'"/><ellipse cx="'+bx+'" cy="36" rx="14" ry="18" fill="'+c+'" opacity=".18"/></g>'}
    svg.setAttribute("viewBox","0 0 "+w+" 60");svg.innerHTML=h;
  }
  drawLights();window.addEventListener("resize",drawLights);

  /* ---------- snow ---------- */
  (function(){
    var c=$("snow"),x=c.getContext("2d"),flakes=[],W,H,dpr=Math.min(2,window.devicePixelRatio||1);
    if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    function size(){W=c.width=innerWidth*dpr;H=c.height=innerHeight*dpr;c.style.width=innerWidth+"px";c.style.height=innerHeight+"px"}
    size();addEventListener("resize",size);
    var N=Math.min(140,Math.round(innerWidth/9));
    for(var i=0;i<N;i++)flakes.push({x:Math.random()*W,y:Math.random()*H,r:(Math.random()*2.4+.8)*dpr,s:(Math.random()*.6+.3)*dpr,d:Math.random()*Math.PI*2});
    (function tick(){
      x.clearRect(0,0,W,H);x.fillStyle="rgba(255,255,255,.85)";x.beginPath();
      for(var i=0;i<flakes.length;i++){var f=flakes[i];f.y+=f.s;f.d+=.01;f.x+=Math.sin(f.d)*.4*dpr;
        if(f.y>H+5){f.y=-5;f.x=Math.random()*W}x.moveTo(f.x,f.y);x.arc(f.x,f.y,f.r,0,Math.PI*2)}
      x.fill();requestAnimationFrame(tick);
    })();
  })();

  /* ---------- sack + counter ---------- */
  function updateCounter(){
    var s=state;
    if(!s||!s.exists){$("counter").classList.add("hidden");$("sackNum").classList.add("hidden");$("sackG").classList.remove("hidden");return}
    $("counter").classList.remove("hidden");
    var drawn=s.total-s.remaining;
    $("meter").style.width=(drawn/s.total*100)+"%";
    if(s.full) $("leftText").innerHTML="All <b>"+s.total+"</b> names drawn";
    else $("leftText").innerHTML="<b>"+s.remaining+"</b> of "+s.total+" names still in the sack";
    $("sackG").classList.toggle("hidden",!s.full);
    $("sackNum").classList.toggle("hidden",s.full);
    $("sackNum").textContent=s.remaining;
  }
  function wiggle(){var k=$("sack");k.classList.remove("wiggle");void k.offsetWidth;k.classList.add("wiggle")}

  /* ---------- views ---------- */
  function hasNewHint(){
    if(!me||!me.matchHintAt) return false;
    var seen=ls.get("gs-santa-hint-seen");
    return seen!==me.matchHintAt;
  }
  function bannerHTML(){
    if(!me) return "";
    var newHint=hasNewHint();
    return '<div class="mine"><p>You\'ve drawn as <b>'+esc(me.name)+'</b>.'+(newHint?'<span class="new">New wish list hint</span>':'')+'</p>'+
      '<div class="acts"><button class="btn btn-y" type="button" id="seeMine">'+(newHint?"See their hint":"See who you got")+'</button></div></div>';
  }
  function render(){
    updateCounter();
    var v=$("view"),s=state;
    if(!s){v.innerHTML='<div class="loading">Checking with the elves…</div>';return}
    if(s.error&&!s.exists&&s._status!==200){v.innerHTML='<div class="panel"><h2>Hmm</h2><p class="sub">'+esc(s.error)+'</p><button class="btn btn-y" onclick="location.reload()">Try again</button></div>';return}
    if(!s.exists){renderSetup();return}
    var banner=bannerHTML();
    if(s.full){
      $("lead").textContent="Every name has been pulled from the sack.";
      v.innerHTML='<div class="full"><div class="eyebrow">That\'s everyone</div><h2>Santa\'s sack is full!</h2><p>All '+s.total+' Secret Santas have their names. Time to go shopping'+(s.budget?' (budget '+esc(s.budget)+')':'')+'.</p></div>'+banner+
        (me?'':'<p style="text-align:center;margin-top:18px;color:rgba(246,242,234,.75);font-size:15px">Drawn on another phone? Open the personal link you saved after drawing.</p>');
    } else {
      $("lead").textContent=me?"You're all set. Here's who's still to draw.":"Tap your name, open your present, find out who you're buying for. Shh.";
      var grid=s.names.map(function(n){
        var gone=s.claimed.indexOf(n)>-1;
        return gone?'<button class="nm gone" type="button" data-gone="'+esc(n)+'">'+esc(n)+'<small>Drawn</small></button>'
                   :'<button class="nm" type="button" data-n="'+esc(n)+'"'+(me?' disabled style="cursor:default"':'')+'>'+esc(n)+'<small>'+(me?"Still to draw":"Tap if this is you")+'</small></button>';
      }).join("");
      v.innerHTML=banner+'<div class="panel"><h2>'+(me?"Still to draw":"Who are you?")+'</h2><p class="sub">'+(me?"Nudge anyone who hasn't had their go yet.":"Pick your own name. Once you've drawn, nobody else can pick it.")+'</p><div class="names" id="names">'+grid+'</div></div>';
      $("names").addEventListener("click",function(e){
        var g=e.target.closest("button[data-gone]");
        if(g&&!me){openModal('<div class="eyebrow">Already drawn</div><h3>'+esc(g.dataset.gone)+'</h3><p>This name has already been pulled from the sack. If '+esc(g.dataset.gone)+' is you and you haven\'t drawn yet, message '+esc(organiser())+' and they\'ll put it back.</p><p style="font-size:14px;color:var(--grey-60);margin-top:-8px">Drew on another phone? Open the personal link you saved.</p><div class="row center"><button class="btn btn-y" id="mClose" type="button">OK</button></div>');$("mClose").onclick=closeModal;return}
        var b=e.target.closest("button[data-n]");if(b&&!me)confirmName(b.dataset.n);
      });
    }
    if(me) $("seeMine").addEventListener("click",function(){showMine()});
  }

  function renderSetup(){
    $("lead").textContent="Load up Santa's sack. Check the names, set a PIN, then share the link with the team.";
    var draft=ls.get("gs-santa-draft")||{names:["Rach Leung","Matthew Kwan","Cindy Chow","Elaine Tsung","James Bernardo","Nicole Lau","Michelle Lee","Cristal Li","Katherine Fung","Wong Gu Leung"].join("\n"),org:"James"};
    $("view").innerHTML=
      '<form class="panel" id="setupForm"><h2>Fill the sack</h2><p class="sub">Organiser only. Do this once, then send everyone the link.</p>'+
      '<label class="f" for="sNames">Names <span>one per line, or commas</span></label><textarea id="sNames" placeholder="Natalie&#10;Matthew&#10;James&#10;…">'+esc(draft.names||"")+'</textarea>'+
      '<div class="two"><div><label class="f" for="sBudget">Budget <span>optional</span></label><input id="sBudget" type="text" maxlength="30" placeholder="HK$200" value="'+esc(draft.budget||"")+'"></div>'+
      '<div><label class="f" for="sDate">Swap day <span>optional</span></label><input id="sDate" type="text" maxlength="60" placeholder="Fri 19 Dec, Wan Chai" value="'+esc(draft.date||"")+'"></div></div>'+
      '<label class="f" for="sEx">Keep apart <span>optional, two names per line, e.g. Kate &amp; James</span></label><textarea id="sEx" style="min-height:70px" placeholder="Kate & James">'+esc(draft.ex||"")+'</textarea>'+
      '<div class="two"><div><label class="f" for="sOrg">Organiser <span>who people message for help</span></label><input id="sOrg" type="text" maxlength="40" value="'+esc(draft.org||"")+'"></div>'+
      '<div><label class="f" for="sPin">Organiser PIN <span>to manage it later</span></label><input id="sPin" type="password" maxlength="40" autocomplete="new-password" placeholder="At least 4 characters"></div></div>'+
      '<div class="err" id="sErr"></div>'+
      '<div class="row" style="margin-top:18px"><button class="btn btn-r btn-big" type="submit" id="sGo">Fill the sack</button></div>'+
      '<p class="note">The draw happens straight away. Nobody, including you, can see who got who.</p></form>';
    var save=function(){ls.set("gs-santa-draft",{names:$("sNames").value,budget:$("sBudget").value,date:$("sDate").value,ex:$("sEx").value,org:$("sOrg").value})};
    ["sNames","sBudget","sDate","sEx","sOrg"].forEach(function(id){$(id).addEventListener("input",save)});
    $("setupForm").addEventListener("submit",function(e){
      e.preventDefault();if(busy)return;
      var names=$("sNames").value.split(/[\n,;]+/).map(function(n){return n.trim()}).filter(Boolean);
      var ex=$("sEx").value.split(/\n+/).map(function(l){var p=l.split(/\s*(?:&|\+|\/|,|\band\b)\s*/i).map(function(x){return x.trim()}).filter(Boolean);return p.length===2?p:null}).filter(Boolean);
      var bad=ex.filter(function(p){return names.indexOf(p[0])<0||names.indexOf(p[1])<0});
      if(bad.length){$("sErr").textContent="Keep-apart names must match the list exactly: "+bad.map(function(p){return p.join(" & ")}).join(", ");return}
      busy=true;$("sGo").disabled=true;$("sErr").textContent="";
      api({action:"setup",names:names,budget:$("sBudget").value,date:$("sDate").value,organiser:$("sOrg").value,exclusions:ex,pin:$("sPin").value}).then(function(r){
        busy=false;$("sGo").disabled=false;
        if(r.error){$("sErr").textContent=r.error;return}
        ls.del("gs-santa-draft");ls.del("gs-santa-claim");ls.del("gs-santa-hint-seen");me=null;
        state=r;wiggle();render();showShare(true);
      });
    });
  }

  function showShare(fresh){
    openModal('<div class="eyebrow">'+(fresh?"The sack is full of names":"Share the link")+'</div><h3>'+(fresh?"Now send the link":"Invite the elves")+'</h3>'+
      '<p>Drop this in the WhatsApp group. Each person taps their own name to get their match.'+(fresh?" Don't forget to draw your own name too.":"")+'</p>'+
      '<div class="linkbox"><input type="text" readonly id="shareIn" value="'+esc(shareUrl())+'"><button class="btn btn-y" id="copyBtn" type="button">Copy</button></div>'+
      '<div class="row center" style="margin-top:18px"><button class="btn btn-ghost" id="mClose" type="button">Done</button></div>');
    $("copyBtn").onclick=function(){copy(shareUrl(),"shareIn","Link copied")};
    $("shareIn").onclick=function(){this.select()};
    $("mClose").onclick=closeModal;
  }
  function copy(t,inputId,msg){
    var done=function(){toast(msg||"Copied")};
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done,fb); else fb();
    function fb(){var i=inputId&&$(inputId);if(i){i.select();try{document.execCommand("copy");done()}catch(e){toast("Select the link and copy it")}}}
  }

  function openModal(html){$("modal").innerHTML=html;$("overlay").classList.add("on")}
  function closeModal(){$("overlay").classList.remove("on");$("modal").innerHTML=""}
  $("overlay").addEventListener("click",function(e){if(e.target===this&&!busy&&!$("gift")&&!$("hintIn"))closeModal()});

  function confirmName(n){
    openModal('<div class="eyebrow">Just checking</div><h3>Are you '+esc(n)+'?</h3><p>You only get one go, and your name leaves the sack for good.</p>'+
      '<div class="err" id="cErr"></div><div class="row center"><button class="btn btn-ghost" id="cNo" type="button">No, go back</button><button class="btn btn-r" id="cYes" type="button">Yes, that\'s me</button></div>');
    $("cNo").onclick=closeModal;
    $("cYes").onclick=function(){
      if(busy)return;busy=true;this.disabled=true;this.textContent="Rummaging…";
      api({action:"claim",name:n}).then(function(r){
        busy=false;
        if(r.error){
          if(r.names){state=r;render()}
          $("cErr").textContent=r.error;$("cYes").disabled=false;$("cYes").textContent="Yes, that's me";
          if(r._status===409){$("cYes").classList.add("hidden");$("cNo").textContent="OK"}
          return;
        }
        ls.set("gs-santa-claim",{name:r.name,token:r.token});
        me=r;state=r;wiggle();
        giftStep();
      });
    };
  }

  /* ---------- after drawing: 1 open present, 2 your hint, 3 save your link ---------- */
  function steps(n){return '<div class="steps"><i class="'+(n>=1?"on":"")+'"></i><i class="'+(n>=2?"on":"")+'"></i><i class="'+(n>=3?"on":"")+'"></i></div>'}
  function metaHTML(){var m="";if(state.budget)m+='<span>Budget: '+esc(state.budget)+'</span>';if(state.date)m+='<span>'+esc(state.date)+'</span>';return m?'<div class="meta">'+m+'</div>':""}
  function theirHintHTML(){
    if(me.matchHint) return '<div class="hintcard"><span class="lbl">'+esc(me.match)+'\'s wish list hint</span><span class="txt">'+esc(me.matchHint)+'</span></div>';
    return '<div class="hintcard empty"><span class="lbl">Wish list hint</span><span class="txt">'+esc(me.match)+' hasn\'t added one yet. Check back later with your personal link.</span></div>';
  }
  function markHintSeen(){if(me&&me.matchHintAt)ls.set("gs-santa-hint-seen",me.matchHintAt)}

  function giftStep(){
    openModal(steps(1)+'<div class="eyebrow">For '+esc(me.name)+' only</div><h3>Your present</h3>'+
      '<div class="gift pulse" id="gift" role="button" tabindex="0" aria-label="Open your present"><div class="box"></div><div class="rv"></div><div class="rh"></div><div class="lid"></div><div class="bow"></div><span class="tap">Tap to open</span></div>'+
      '<div class="reveal" id="rev"><div class="eyebrow">You\'re Secret Santa for</div><div class="target"><span>'+esc(me.match)+'</span></div>'+metaHTML()+theirHintHTML()+
      '<button class="btn btn-y" id="gNext" type="button">Next: your wish list</button></div>');
    var g=$("gift");
    var open=function(){
      if(g.classList.contains("open"))return;g.classList.remove("pulse");g.classList.add("open");
      setTimeout(function(){g.style.display="none";$("rev").classList.add("on");confetti($("modal"));markHintSeen()},450);
    };
    g.addEventListener("click",open);g.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
    $("gNext").onclick=function(){hintStep(function(){linkStep()})};
  }

  function hintStep(next){
    openModal(steps(2)+'<div class="eyebrow">Help your Secret Santa</div><h3>Your wish list</h3>'+
      '<p>Drop a hint for whoever drew you. They\'ll see it next time they check.</p>'+
      '<textarea class="hint" id="hintIn" maxlength="140" placeholder="e.g. Good coffee, plants, anything Arsenal">'+esc(me.myHint||"")+'</textarea><div class="charc" id="hintC"></div>'+
      '<div class="err" id="hErr"></div>'+
      '<div class="row center" style="margin-top:14px"><button class="btn btn-ghost" id="hSkip" type="button">Skip for now</button><button class="btn btn-y" id="hSave" type="button">Save hint</button></div>');
    var ta=$("hintIn"),cc=function(){$("hintC").textContent=ta.value.length+"/140"};cc();ta.addEventListener("input",cc);
    $("hSkip").onclick=next;
    $("hSave").onclick=function(){
      if(busy)return;var txt=ta.value.trim();
      if(txt===(me.myHint||"")){next();return}
      busy=true;this.disabled=true;this.textContent="Saving…";
      api({action:"hint",token:me.token,text:txt}).then(function(r){
        busy=false;
        if(r.error){$("hErr").textContent=r.error;$("hSave").disabled=false;$("hSave").textContent="Save hint";return}
        me=r;toast(txt?"Hint saved":"Hint removed");next();
      });
    };
  }

  function linkStep(){
    var url=myLink(me.token);
    openModal(steps(3)+'<div class="eyebrow">Last thing</div><h3>Save your link</h3>'+
      '<p>This is your personal link back to your match and their wish list hint, from any phone. Keep it to yourself.</p>'+
      '<div class="stack"><a class="btn btn-wa" href="https://wa.me/?text='+encodeURIComponent("My Secret Santa link (don't share): "+url)+'" target="_blank" rel="noopener">Send it to myself on WhatsApp</a>'+
      '<div class="linkbox" style="margin:0"><input type="text" readonly id="myIn" value="'+esc(url)+'"><button class="btn btn-y" id="myCopy" type="button">Copy</button></div></div>'+
      '<div class="shot"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg><span>Belt and braces: screenshot your match too. In WhatsApp, pick "Message yourself" to send it to just you.</span></div>'+
      '<div class="row center" style="margin-top:18px"><button class="btn btn-ghost" id="lDone" type="button">Done</button></div>');
    $("myCopy").onclick=function(){copy(url,"myIn","Your link is copied")};
    $("myIn").onclick=function(){this.select()};
    $("lDone").onclick=function(){closeModal();render()};
  }

  /* ---------- coming back ---------- */
  function showMine(){
    if(busy||!me)return;busy=true;
    api({action:"mine",token:me.token}).then(function(r){
      busy=false;
      if(r.error){toast(r.error);forget();return}
      me=r;state=r;render();
      var url=myLink(me.token);
      openModal('<div class="eyebrow">For '+esc(me.name)+' only</div><h3>Your match</h3>'+
        '<div class="eyebrow" style="margin-top:4px">You\'re Secret Santa for</div><div class="target"><span>'+esc(me.match)+'</span></div>'+metaHTML()+theirHintHTML()+
        '<div class="hintcard'+(me.myHint?'':' empty')+'"><span class="lbl">Your own hint</span><span class="txt">'+esc(me.myHint||"You haven't added one yet.")+'</span></div>'+
        '<div class="stack"><button class="btn btn-ghost" id="mEdit" type="button">'+(me.myHint?"Edit my hint":"Add my hint")+'</button>'+
        '<div class="linkbox" style="margin:0"><input type="text" readonly id="myIn" value="'+esc(url)+'"><button class="btn btn-y" id="myCopy" type="button">Copy my link</button></div></div>'+
        '<div class="row center" style="margin-top:18px"><button class="btn btn-dark" style="background:var(--ink);color:var(--cream)" id="mDone" type="button">Close</button></div>');
      markHintSeen();
      $("mEdit").onclick=function(){hintStep(function(){closeModal();showMine()})};
      $("myCopy").onclick=function(){copy(url,"myIn","Your link is copied")};
      $("myIn").onclick=function(){this.select()};
      $("mDone").onclick=function(){closeModal();render()};
    });
  }
  function forget(){ls.del("gs-santa-claim");ls.del("gs-santa-hint-seen");me=null;refresh(true)}

  function confetti(host){
    var c=document.createElement("div");c.className="confetti";var cols=["#FFC700","#FA4261","#2D6373","#4CB838","#FFC700"];
    for(var i=0;i<50;i++){var p=document.createElement("i");p.style.left=Math.random()*100+"%";p.style.background=cols[i%cols.length];p.style.animationDelay=(Math.random()*.35)+"s";p.style.animationDuration=(1.2+Math.random()*.9)+"s";c.appendChild(p)}
    host.appendChild(c);setTimeout(function(){c.remove()},2800);
  }

  /* ---------- organiser ---------- */
  $("orgBtn").addEventListener("click",function(){
    if(!state||!state.exists){window.scrollTo({top:0,behavior:"smooth"});toast("Fill the sack above to start");return}
    openModal('<div class="eyebrow">Organiser</div><h3>Elf HQ</h3><p>Enter the PIN you set when you filled the sack.</p>'+
      '<input type="password" id="oPin" placeholder="PIN" autocomplete="current-password"><div class="err" id="oErr"></div>'+
      '<div class="row center" style="margin-top:16px"><button class="btn btn-ghost" id="oNo" type="button">Cancel</button><button class="btn btn-y" id="oGo" type="button">Open</button></div>');
    $("oNo").onclick=closeModal;
    var go=function(){var pin=$("oPin").value;api({action:"check",pin:pin}).then(function(r){if(r.error){$("oErr").textContent=r.error;return}state=r;render();admin(pin,r.people)})};
    $("oGo").onclick=go;$("oPin").addEventListener("keydown",function(e){if(e.key==="Enter")go()});
    setTimeout(function(){$("oPin")&&$("oPin").focus()},50);
  });
  function when(iso){
    if(!iso)return "";var d=new Date(iso);
    try{return d.toLocaleString("en-GB",{weekday:"short",hour:"numeric",minute:"2-digit",timeZone:"Asia/Hong_Kong"})}catch(e){return d.toLocaleString()}
  }
  function admin(pin,people){
    var s=state,hinted=people.filter(function(p){return p.hint}).length;
    var list=people.map(function(p){
      var sub=p.drawn?("Drawn "+when(p.at)+(p.device?" · "+esc(p.device):"")+" · "+(p.hint?"hint added":"no hint yet")):"Not drawn yet";
      return '<li><span class="who">'+esc(p.name)+'<small>'+sub+'</small></span>'+(p.drawn?'<button class="mini" data-rel="'+esc(p.name)+'" type="button">Put back</button>':'<span class="st">Waiting</span>')+'</li>'}).join("");
    openModal('<div class="eyebrow">Organiser</div><h3>Elf HQ</h3><p>'+(s.total-s.remaining)+' of '+s.total+' have drawn, '+hinted+' have added a hint. You can\'t see who got who.</p>'+
      '<div class="row center"><button class="btn btn-y" id="aShare" type="button">Copy share link</button></div>'+
      '<ul class="admin-list" id="aList">'+list+'</ul>'+
      '<p class="note" style="text-align:left">Two names drawn at the same time on the same kind of phone can mean someone tapped the wrong one. "Put back" re-opens a name and clears its hint. Their match stays the same, so if someone saw a match they shouldn\'t have, empty the sack and redraw.</p>'+
      '<input type="text" readonly id="shareIn" value="'+esc(shareUrl())+'" style="position:absolute;left:-9999px">'+
      '<div class="err" id="aErr"></div>'+
      '<div class="row center" style="margin-top:16px"><button class="btn btn-ghost" id="aClose" type="button">Close</button><button class="btn btn-r" id="aReset" type="button">Empty the sack</button></div>');
    $("aClose").onclick=closeModal;
    $("aShare").onclick=function(){copy(shareUrl(),"shareIn","Link copied")};
    $("aList").addEventListener("click",function(e){var b=e.target.closest("button[data-rel]");if(!b)return;
      var n=b.dataset.rel;
      api({action:"release",name:n,pin:pin}).then(function(r){if(r.error){$("aErr").textContent=r.error;return}
        if(me&&me.name===n)forget();
        api({action:"check",pin:pin}).then(function(c){state=c;render();admin(pin,c.people);toast(n+" is back in the sack")})});
    });
    $("aReset").onclick=function(){
      var b=this;if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Tap again to delete the draw";return}
      api({action:"reset",pin:pin}).then(function(r){if(r.error){$("aErr").textContent=r.error;return}ls.del("gs-santa-claim");ls.del("gs-santa-hint-seen");me=null;state=r;closeModal();render();toast("Sack emptied. Start a new draw.")});
    };
  }

  /* ---------- load + refresh ---------- */
  function loadMe(){
    var c=claim();
    if(!c||!c.token) return Promise.resolve(null);
    return api({action:"mine",token:c.token}).then(function(r){
      if(r.error){if(r._status===404){ls.del("gs-santa-claim");ls.del("gs-santa-hint-seen")}return null}
      ls.set("gs-santa-claim",{name:r.name,token:r.token});
      return r;
    });
  }
  function refresh(force){
    if(!force&&(busy||$("overlay").classList.contains("on")))return;
    Promise.all([api(),loadMe()]).then(function(res){
      var prev=JSON.stringify([state&&state.exists,state&&state.claimed,me&&me.name,me&&me.matchHintAt]);
      state=res[0];me=res[1];
      if(force||prev!==JSON.stringify([state.exists,state.claimed,me&&me.name,me&&me.matchHintAt])) render(); else updateCounter();
    });
  }

  // Arriving from a personal link: remember it on this device, then tidy the address bar.
  var q=new URLSearchParams(location.search),t=q.get("me");
  var arrivedWithLink=false;
  if(t&&/^[a-f0-9]{16,64}$/.test(t)){
    ls.set("gs-santa-claim",{token:t});arrivedWithLink=true;
    try{history.replaceState(null,"",location.pathname)}catch(e){}
  }
  Promise.all([api(),loadMe()]).then(function(res){
    state=res[0];me=res[1];render();
    if(arrivedWithLink){if(me)showMine();else toast("That link doesn't match the current draw")}
  });
  setInterval(function(){refresh(false)},15000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)refresh(false)});
})();
