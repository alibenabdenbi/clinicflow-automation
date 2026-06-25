async function jget(url){ const r = await fetch(url); return r.json(); }
async function jpost(url, body){
  const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
  return r.json();
}

function el(tag, attrs={}, children=[]){
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k === "class") n.className = v;
    else if(k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  });
  children.forEach(c => n.appendChild(c));
  return n;
}

async function approve(task){
  // copy suggested text
  await navigator.clipboard.writeText(task.suggestedText || "");
  // open post + profile (user can close tabs)
  if (task.postUrl) window.open(task.postUrl, "_blank");
  if (task.profileUrl) window.open(task.profileUrl, "_blank");

  await jpost("/api/crm/action", {
    leadId: task.leadId,
    action: "approve",
    channel: task.type || "unknown",
    note: ""
  });

  alert("Copied to clipboard ✅\nNow paste it and send manually.");
}

async function markSent(task){
  await jpost("/api/crm/action", {
    leadId: task.leadId,
    action: "sent",
    channel: task.type || "unknown",
    note: ""
  });
  alert("Marked as sent ✅");
}

async function skip(task){
  await jpost("/api/crm/action", {
    leadId: task.leadId,
    action: "skip",
    channel: task.type || "unknown",
    note: ""
  });
  alert("Skipped ✅");
}

function renderTask(task){
  const top = el("div", { class:"taskTop" }, [
    el("div", {}, [
      el("div", { class:"title", text: task.postTitle || "(no title)" }),
      el("div", { class:"meta" }, [
        el("span", { class:"tag", text: (task.platform || "unknown").toUpperCase() }),
        el("span", { class:"tag", text: `Tier ${task.tier || "B"}` }),
        task.subreddit ? el("span", { class:"tag", text: `r/${task.subreddit}` }) : el("span"),
        task.type ? el("span", { class:"tag", text: task.type }) : el("span"),
        task.name ? el("span", { class:"tag", text: task.name }) : el("span"),
      ])
    ]),
    el("div", {}, [
      task.postUrl ? el("div", {}, [ el("a", { href: task.postUrl, target:"_blank" , text:"Open post ↗" }) ]) : el("div"),
      task.profileUrl ? el("div", {}, [ el("a", { href: task.profileUrl, target:"_blank" , text:"Open profile ↗" }) ]) : el("div"),
    ])
  ]);

  const msg = el("div", { class:"msg" });
  msg.textContent = task.suggestedText || "";

  const actions = el("div", { class:"actions" }, [
    el("button", { class:"btn primary", text:"Approve (copy + open)" }),
    el("button", { class:"btn", text:"Mark Sent" }),
    el("button", { class:"btn danger", text:"Skip" }),
  ]);

  actions.children[0].onclick = () => approve(task);
  actions.children[1].onclick = () => markSent(task);
  actions.children[2].onclick = () => skip(task);

  return el("div", { class:"card task" }, [top, msg, actions]);
}

async function load(){
  const tasksWrap = document.getElementById("tasks");
  tasksWrap.innerHTML = "";

  const q = await jget("/api/outreach-queue");
  const tasks = q?.tasks || [];
  const counts = q?.counts || {};

  document.getElementById("generatedAt").textContent = `Generated: ${q?.generatedAt || "—"}`;
  document.getElementById("leadsTotal").textContent = counts.totalLeads ?? "—";
  document.getElementById("tasksToday").textContent = counts.tasks_today ?? tasks.length ?? "—";
  document.getElementById("tierA").textContent = counts.tierA_new ?? "—";
  document.getElementById("tierB").textContent = counts.tierB_new ?? "—";

  const status = document.getElementById("statusPill");
  status.textContent = tasks.length ? "Status: Ready" : "Status: No tasks";
  tasks.forEach(t => tasksWrap.appendChild(renderTask(t)));
}

document.getElementById("refreshBtn").addEventListener("click", load);
load();
