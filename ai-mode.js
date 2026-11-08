(() => {
"use strict";
const AI_API="https://gozie-search-ai.henrymeraldcompany.workers.dev";
const $=s=>document.querySelector(s);
const page=$("#main-content"),aiView=$("#ai-mode-view"),aiTab=$("#ai-mode-tab"),form=$("#search-form"),prompt=$("#ai-prompt"),messagesEl=$("#ai-chat-messages"),historyEl=$("#ai-history-list"),fileInput=$("#ai-file-input"),preview=$("#ai-attachment-preview"),sendButton=$("#ai-send-button"),categoryNav=document.querySelector(".search-tabs"),categorySlot=$("#ai-category-slot"),categoryHome=categoryNav?.parentElement,categoryHomeNext=categoryNav?.nextSibling;
if(!aiView||!form||!aiTab)return;
let active=false,busy=false,attachments=[],chats=[],currentId=null;
try{chats=JSON.parse(localStorage.getItem("gozie-ai-mode-history")||"[]");if(!Array.isArray(chats))chats=[];}catch{chats=[];}
function save(){
  try {
    const stored = chats.slice(0,20).map(chat => ({
      ...chat,
      messages: (chat.messages || []).slice(-40).map(message => ({
        ...message,
        context: typeof message.context === "string" ? message.context.slice(0,18000) : undefined
      }))
    }));
    localStorage.setItem("gozie-ai-mode-history", JSON.stringify(stored));
  } catch {}
}
function newId(){return "chat-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);}
function activeChat(){return chats.find(c=>c.id===currentId);}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function markdown(s){let t=escapeHTML(s);t=t.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gi,(m,l,c)=>"<pre><code>"+c+"</code></pre>");t=t.replace(/`([^`\n]+)`/g,"<code>$1</code>");t=t.replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>");t=t.replace(/^[-*] (.+)$/gm,"• $1").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>");return t.split(/\n{2,}/).map(p=>/^<(h[1-3]|pre)/.test(p)?p:"<p>"+p.replace(/\n/g,"<br>")+"</p>").join("");}
function moveCategoryNav(intoAiMode){if(!categoryNav)return;if(intoAiMode&&categorySlot&&categoryNav.parentElement!==categorySlot)categorySlot.append(categoryNav);else if(!intoAiMode&&categoryHome&&categoryNav.parentElement!==categoryHome)categoryHome.insertBefore(categoryNav,categoryHomeNext);}
function setHistoryOpen(open){aiView.classList.toggle("history-open",Boolean(open));$("#ai-mobile-history")?.setAttribute("aria-expanded",String(Boolean(open)));}
function setActive(on){active=on;aiTab.classList.toggle("active",on);aiTab.setAttribute("aria-pressed",String(on));if(on){moveCategoryNav(true);document.body.classList.add("ai-mode-open");document.querySelectorAll(".search-tab[data-category]").forEach(b=>{b.classList.remove("active");b.setAttribute("aria-pressed","false");});page.classList.add("utility-open");$("#hero").hidden=true;$("#results-section").hidden=true;["settings-view","history-view","google-view"].forEach(id=>{const e=document.getElementById(id);if(e)e.hidden=true;});aiView.hidden=false;window.scrollTo({top:0,behavior:"auto"});setTimeout(()=>prompt.focus({preventScroll:true}),50);}else{setHistoryOpen(false);aiView.hidden=true;moveCategoryNav(false);document.body.classList.remove("ai-mode-open");page.classList.remove("utility-open");if($("#hero"))$("#hero").hidden=false;}}
function openAiMode(){setActive(true);const q=$("#query")?.value.trim();if(q){prompt.value=q;send();}}
aiTab.addEventListener("click",openAiMode);
$("#sidebar-ai-mode")?.addEventListener("click",()=>{$("#sidebar-close")?.click();openAiMode();});
document.querySelectorAll(".search-tab[data-category]").forEach(b=>b.addEventListener("click",()=>{if(active){setActive(false);const q=$("#query")?.value.trim();if(q)setTimeout(()=>form.requestSubmit(),0);}}));
$("#sidebar-new-search")?.addEventListener("click",()=>setActive(false));
document.querySelectorAll("[data-return-home]").forEach(b=>b.addEventListener("click",()=>setActive(false)));
form.addEventListener("submit",e=>{if(!active)return;e.preventDefault();e.stopImmediatePropagation();const q=$("#query")?.value.trim();if(q)prompt.value=q;send();},true);
function renderHistory(){historyEl.replaceChildren();if(!chats.length){const p=document.createElement("p");p.className="ai-history-empty";p.textContent="Your conversations will appear here.";historyEl.append(p);return;}chats.forEach(c=>{const b=document.createElement("button");b.type="button";b.className="ai-history-item"+(c.id===currentId?" active":"");const s=document.createElement("span");s.textContent=c.title||"New conversation";b.append("◷",s);b.addEventListener("click",()=>{currentId=c.id;attachments=[];renderAttachments();renderChat();renderHistory();aiView.classList.remove("history-open");});historyEl.append(b);});}
function renderChat(){messagesEl.replaceChildren();const chat=activeChat();if(!chat||!chat.messages.length){const w=document.createElement("div");w.className="ai-welcome";w.innerHTML='<div class="ai-welcome-mark">✦</div><h1>Ask Gozie AI</h1><p>Explore ideas, understand documents and work through questions with Gozie AI.</p><div class="ai-suggestions"><button type="button" data-ai-prompt="Explain a difficult topic in simple terms.">Explain a topic</button><button type="button" data-ai-prompt="Help me plan a project from start to finish.">Plan a project</button><button type="button" data-ai-prompt="Give me a clear summary of an important subject.">Summarise something</button></div>';messagesEl.append(w);w.querySelectorAll("[data-ai-prompt]").forEach(b=>b.addEventListener("click",()=>{prompt.value=b.dataset.aiPrompt;send();}));return;}chat.messages.forEach(m=>addMessage(m.role,m.content));messagesEl.scrollTop=messagesEl.scrollHeight;}
function addMessage(role,content){const row=document.createElement("div");row.className="ai-message "+role;const avatar=document.createElement("div");avatar.className="ai-message-avatar";avatar.textContent=role==="user"?"Y":"✦";const body=document.createElement("div");body.className="ai-message-content";body.innerHTML=markdown(content);row.append(avatar,body);messagesEl.append(row);if(role==="assistant"){const actions=document.createElement("div");actions.className="ai-message-actions";const copy=document.createElement("button");copy.type="button";copy.textContent="Copy";copy.addEventListener("click",()=>navigator.clipboard?.writeText(content));actions.append(copy);body.append(actions);}messagesEl.scrollTop=messagesEl.scrollHeight;}
function renderAttachments(){preview.replaceChildren();preview.hidden=!attachments.length;attachments.forEach((a,i)=>{const chip=document.createElement("div");chip.className="ai-attachment-chip";const name=document.createElement("span");name.textContent=(a.name||"Attachment")+(a.kind==="image"?" · image":"");const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label","Remove "+a.name);remove.addEventListener("click",()=>{attachments.splice(i,1);renderAttachments();});chip.append(name,remove);preview.append(chip);});}
function loadScript(src){return new Promise((resolve,reject)=>{const existing=[...document.scripts].find(s=>s.src===src);if(existing){existing.addEventListener("load",resolve,{once:true});if(window.pdfjsLib||window.mammoth||window.XLSX)resolve();return;}const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error("Could not load document reader library."));document.head.append(s);});}
async function compressImage(file){const bitmap=await createImageBitmap(file);const scale=Math.min(1,1440/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();return canvas.toDataURL("image/jpeg",0.82);}
async function videoContactSheet(file){const url=URL.createObjectURL(file),video=document.createElement("video");video.preload="metadata";video.muted=true;video.playsInline=true;video.src=url;try{await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error("This video could not be opened. Try MP4 or WebM."));});if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error("The video has no readable duration.");const cellW=480,cellH=270,canvas=document.createElement("canvas");canvas.width=cellW*2;canvas.height=cellH*2;const ctx=canvas.getContext("2d");ctx.fillStyle="#202124";ctx.fillRect(0,0,canvas.width,canvas.height);const marks=[0.08,0.35,0.65,0.92];for(let i=0;i<marks.length;i++){const target=Math.max(0,Math.min(video.duration-0.05,video.duration*marks[i]));await new Promise((resolve,reject)=>{let timer=setTimeout(()=>reject(new Error("Video frame extraction timed out.")),10000);const done=()=>{clearTimeout(timer);resolve();};video.addEventListener("seeked",done,{once:true});video.currentTime=target;});const x=(i%2)*cellW,y=Math.floor(i/2)*cellH;ctx.drawImage(video,x,y,cellW,cellH);ctx.fillStyle="rgba(0,0,0,.65)";ctx.fillRect(x+8,y+8,75,24);ctx.fillStyle="#fff";ctx.font="14px sans-serif";ctx.fillText(Math.floor(target)+"s",x+17,y+25);}return canvas.toDataURL("image/jpeg",0.8);}finally{URL.revokeObjectURL(url);video.remove();}}
async function extractFile(file){const name=file.name.toLowerCase(),type=file.type||"";if(type.startsWith("image/")||/\.(png|jpe?g|webp|gif)$/i.test(name)){if(file.size>10*1024*1024)throw new Error(file.name+" is larger than 10 MB.");const data=await compressImage(file);attachments.push({name:file.name,kind:"image",data,size:file.size});return;
if(type.startsWith("video/")||/\.(mp4|webm|mov|m4v)$/i.test(name)){if(file.size>10*1024*1024)throw new Error(file.name+" is larger than 10 MB.");const data=await videoContactSheet(file);attachments.push({name:file.name,kind:"image",data,size:file.size,note:"Video preview made from four sampled frames."});return;}
if(type.startsWith("audio/")||/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)){if(file.size>10*1024*1024)throw new Error(file.name+" is larger than 10 MB.");const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});attachments.push({name:file.name,kind:"audio",data,size:file.size});return;}
if(/\.(txt|md|csv|json|xml|html|htm)$/i.test(name)||type.startsWith("text/")){const text=await file.text();attachments.push({name:file.name,kind:"text",text:text.slice(0,50000),size:file.size});return;}
if(name.endsWith(".pdf")){if(file.size>10*1024*1024)throw new Error(file.name+" is larger than 10 MB.");await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");if(!window.pdfjsLib)throw new Error("PDF reader did not initialise.");window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let text="";for(let p=1;p<=Math.min(pdf.numPages,35);p++){const page=await pdf.getPage(p);const c=await page.getTextContent();text+=c.items.map(x=>x.str).join(" ")+"\n";if(text.length>50000)break;}attachments.push({name:file.name,kind:"text",text:text.slice(0,50000),size:file.size});return;}
if(name.endsWith(".docx")){if(file.size>10*1024*1024)throw new Error(file.name+" is larger than 10 MB.");await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.9.0/mammoth.browser.min.js");const result=await window.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});attachments.push({name:file.name,kind:"text",text:result.value.slice(0,50000),size:file.size});return;}
if(/\.(xlsx|xls|xlsm|xlsb)$/i.test(name)){if(file.size>10*1024*1024)throw new Error(file.name+" is larger than 10 MB.");await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");const book=window.XLSX.read(await file.arrayBuffer(),{type:"array"});const text=book.SheetNames.slice(0,8).map(n=>"SHEET: "+n+"\n"+window.XLSX.utils.sheet_to_csv(book.Sheets[n])).join("\n\n");attachments.push({name:file.name,kind:"text",text:text.slice(0,50000),size:file.size});return;}
throw new Error("This file type is not supported yet: "+file.name);}
$("#ai-attach-button").addEventListener("click",()=>fileInput.click());
fileInput.addEventListener("change",async()=>{const files=[...fileInput.files];const existingBytes=attachments.reduce((n,a)=>n+(a.size||0),0);if(attachments.length+files.length>4){alert("Gozie AI accepts up to 4 attachments in one message.");fileInput.value="";return;}if(files.some(f=>f.size>10*1024*1024)||existingBytes+files.reduce((n,f)=>n+f.size,0)>20*1024*1024){alert("Each attachment must be 10 MB or smaller, and all attachments together must not exceed 20 MB.");fileInput.value="";return;}for(const file of files){try{await extractFile(file);}catch(error){alert(error.message||"Could not read file.");}}renderAttachments();fileInput.value="";});
function createChat(){const c={id:newId(),title:"New conversation",messages:[],updated:Date.now()};chats.unshift(c);currentId=c.id;save();renderHistory();renderChat();}
function startNew(){attachments=[];renderAttachments();setHistoryOpen(false);createChat();prompt.value="";prompt.focus();}
$("#ai-new-chat")?.addEventListener("click",startNew);$("#ai-new-chat-top")?.addEventListener("click",startNew);
$("#ai-mobile-history")?.addEventListener("click",()=>setHistoryOpen(!aiView.classList.contains("history-open")));
$("#ai-close-history")?.addEventListener("click",()=>setHistoryOpen(false));
$("#ai-clear-history")?.addEventListener("click",()=>{if(!chats.length)return;if(!confirm("Delete all GOZIE AI conversations from this device?"))return;chats=[];currentId=null;save();renderHistory();renderChat();});
async function send(){
  if (busy) return;
  const question = prompt.value.trim();
  if (!question && !attachments.length) return;
  if (!currentId || !activeChat()) createChat();

  const chat = activeChat();
  const attached = attachments.splice(0);
  renderAttachments();

  const description = attached.map(file => {
    if (file.kind === "text") return "\\n\\n[Uploaded file: " + file.name + "]\\n" + file.text;
    if (file.kind === "audio") return "\\n\\n[Uploaded audio: " + file.name + "] (transcribe this audio, then answer the user)";
    return "\\n\\n[Uploaded image/video: " + file.name + "] " + (file.note || "Image attached.");
  }).join("");
  const displayText = question + (attached.length ? "\\n\\n📎 " + attached.map(file => file.name).join(", ") : "");
  const apiContent = [{ type: "text", text: (question || "Please inspect the attached file(s).") + description }];
  attached.filter(file => file.kind === "image").forEach(file => {
    apiContent.push({ type: "image_url", image_url: { url: file.data } });
  });
  attached.filter(file => file.kind === "audio").forEach(file => {
    apiContent.push({ type: "audio_data", data: file.data });
  });

  chat.messages.push({ role: "user", content: displayText, context: description });
  if (chat.messages.length === 1) chat.title = (question || attached[0]?.name || "New conversation").slice(0, 64);
  chat.updated = Date.now();
  save();
  prompt.value = "";
  renderChat();

  const typing = document.createElement("div");
  typing.className = "ai-typing";
  typing.textContent = "Gozie AI is thinking…";
  messagesEl.append(typing);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  busy = true;
  sendButton.disabled = true;

  try {
    const recent = chat.messages.slice(-20);
    const history = recent.map((message, index) => {
      if (message.role === "user" && index === recent.length - 1) {
        return { role: "user", content: apiContent };
      }
      if (message.role === "user" && message.context) {
        return { role: "user", content: message.content + "\\n\\n" + message.context };
      }
      return { role: message.role, content: message.content };
    });

    const response = await fetch(AI_API + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, max_tokens: 2048 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.detail || "AI request failed (" + response.status + ").");

    const answer = data.choices?.[0]?.message?.content || data.response || "No answer was returned.";
    chat.messages.push({ role: "assistant", content: answer });
    chat.updated = Date.now();
    save();
  } catch (error) {
    const message = error instanceof TypeError
      ? "Gozie AI could not connect to its assistant service. Check your internet connection and try again."
      : error?.name === "TimeoutError"
        ? "Gozie AI took too long to respond. Please try again."
        : (error.message || "Please try again later.");
    chat.messages.push({ role: "assistant", content: "I could not complete that request. " + message });
    save();
  } finally {
    busy = false;
    sendButton.disabled = false;
    renderHistory();
    renderChat();
  }
}
$("#ai-chat-form").addEventListener("submit",e=>{e.preventDefault();send();});
prompt.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}});
renderHistory();renderChat();
})();