export function dashboard(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cicero AI · Quality evidence</title>
<style nonce="${nonce}">
:root{font-family:system-ui,sans-serif;color:#172437;background:#f3f6fa;font-synthesis:none}*{box-sizing:border-box}body{margin:0}header{background:#132638;color:#fff;padding:24px 5%;display:flex;align-items:center;justify-content:space-between}header strong{font-size:24px}header span{color:#b5cbdc;font-size:13px;letter-spacing:.08em}main{max-width:1200px;margin:auto;padding:36px 24px}h1{font-size:30px;margin:0 0 8px}h2{font-size:20px;margin:0 0 18px}p{color:#56677a;line-height:1.6}.intro{margin-bottom:26px}.panel{background:white;border:1px solid #dce3ec;border-radius:12px;padding:24px;margin-bottom:24px}.connect{display:flex;gap:12px;flex-wrap:wrap;align-items:end}label{font-size:13px;display:block;font-weight:600;margin-bottom:7px}input{border:1px solid #aebccb;border-radius:6px;padding:11px;font:inherit;width:330px;max-width:100%}button{background:#19647a;color:white;border:0;border-radius:6px;padding:12px 16px;font:inherit;cursor:pointer}button.secondary{background:#edf2f7;color:#22364c}button.danger{background:#fff0ed;color:#a8342a}button:disabled{opacity:.5;cursor:default}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.metric{padding:22px;background:white;border:1px solid #dce3ec;border-radius:12px}.metric strong{display:block;font-size:28px;margin:10px 0}.muted{font-size:13px;color:#66788a}.badge{font-size:12px;border-radius:20px;background:#fff0d1;color:#805400;padding:5px 10px;display:inline-block}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:13px 10px;border-bottom:1px solid #edf1f5;font-size:13px}th{color:#64748b}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,monospace;background:#f5f7fa;border-radius:6px;padding:16px}.plan{border:1px solid #e1e7ee;border-radius:8px;padding:18px;margin:14px 0}.actions{display:flex;gap:9px;flex-wrap:wrap}#message{min-height:24px;color:#805400}footer{font-size:12px;color:#66788a;margin-top:28px}@media(max-width:720px){.metrics{grid-template-columns:repeat(2,1fr)}header{padding:20px}header span{display:none}.panel{padding:18px}main{padding:24px 14px}table{display:block;overflow:auto}}
.feature-evidence{border-top:1px solid #dce3ec;margin-top:22px;padding-top:12px}.feature-evidence>strong{display:block;color:#174f62;font-size:18px}.history-entry{border-left:3px solid #dce3ec;padding-left:14px;margin:18px 0}summary{cursor:pointer;font-weight:600}#detail{margin-top:28px;overflow-wrap:anywhere}#reports td:nth-child(3){font-family:ui-monospace,monospace;word-break:break-all;max-width:180px}#reports td:nth-child(5){min-width:180px}
</style></head><body><header><strong>Cicero AI <small> / Cai</small></strong><span>SOURCE-BACKED QUALITY EVIDENCE</span></header><main>
<div class="intro"><h1>Is the feature ready for Playwright E2E testing?</h1><p>Review requirements, application revisions, prerequisites and recorded evidence. Completed analysis, test readiness and verified coverage are separate decisions.</p></div>
<section class="panel"><h2>Connect to this installation</h2><div class="connect"><div><label for="token">Scoped operator token</label><input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Enter your local API token"></div><button id="connect">Connect</button><button id="refresh" class="secondary" disabled>Refresh evidence</button></div><p class="muted">The token stays in this page's memory. It is never saved to browser storage.</p><div id="message" role="status" aria-live="polite">Connect to load authorised records.</div></section>
<div id="content" hidden><section class="metrics" id="metrics"></section><section class="panel"><h2>Latest assessments</h2><p class="muted">Inspect an assessment for prerequisites, specific blockers and execution evidence. Earlier application revisions do not inherit a later build's readiness.</p><table><thead><tr><th>Assessment</th><th>Requirement</th><th>Application revision</th><th>Analysis state</th><th>Test readiness</th><th></th></tr></thead><tbody id="reports"></tbody></table><div id="detail" hidden aria-live="polite"></div></section><section class="panel"><h2>Approval queue</h2><p class="muted">Approval binds the displayed immutable plan. Revoked, expired or superseded plans cannot authorise an action. Cai reads the application repository; VCS publication is limited to test-only PRs/MRs in a separately configured Playwright automation repository. Developers review and merge in the VCS. Publishing requires a separate operator command; dashboard approval alone does not publish.</p><div id="plans"></div></section></div><footer>Customer-managed installation · No default vendor telemetry · Provider and runner limits remain visible in each milestone's evidence record.</footer></main>
<script nonce="${nonce}">
let token='';const el=id=>document.getElementById(id);const message=text=>{el('message').textContent=text;};
async function api(url,body){const response=await fetch(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw new Error(value.error||'Request failed.');return value;}
function node(tag,text,cls){const item=document.createElement(tag);item.textContent=text;if(cls)item.className=cls;return item;}
function verdict(readiness){
  if(!readiness)return 'Readiness unknown: prerequisite evidence is unavailable.';
  if(readiness.eligibleForPlan)return 'Ready for automated Playwright E2E testing';
  if(readiness.code==='blocked'||readiness.feature==='blocked')return 'Not ready: code dependencies are incomplete.';
  if(readiness.environment==='blocked')return 'Not ready: environment prerequisites are blocked.';
  if(readiness.data==='blocked')return 'Not ready: test data is blocked.';
  return 'Readiness unknown: prerequisites need confirmation.';
}
function assessedVerdict(data,feature){
  if(data.stale)return 'Readiness unknown: source evidence is stale.';
  if(!feature)return 'Readiness unknown: no unique feature is linked.';
  if(feature.current&&feature.current.appSha!==data.report.headSha)return 'Readiness unknown for this assessed revision: the feature now targets another build.';
  return verdict(feature.current);
}
function sourceLabel(value){return /^github:pr:[0-9]+$/.test(value||'')?'PR #'+value.split(':').pop():value||'No linked PR recorded';}
async function loadEvidence(summary,cache){
  const data=await api('/api/reports/'+encodeURIComponent(summary.assessment_id));
  data.assessmentSource=summary.source_id;
  data.features=await Promise.all(data.features.map(async feature=>{
    if(!cache.has(feature.id))cache.set(feature.id,api('/api/features/'+encodeURIComponent(feature.id)+'/readiness').catch(()=>null));
    return {...feature,current:await cache.get(feature.id)};
  }));
  return data;
}
function showEvidence(data,coverage){
  const panel=el('detail');panel.replaceChildren();panel.hidden=false;
  panel.append(node('h2','Assessment evidence: '+sourceLabel(data.assessmentSource)),node('p','Requirement: '+(data.report.requirements.map(item=>item.text).join(' · ')||'No explicit requirement recorded.')),
    node('p','Assessed application revision: '+data.report.headSha),
    node('p',data.report.state==='assessment_ready'?'Analysis complete (assessment_ready). Test readiness is assessed separately.':'Analysis state: '+data.report.state),
    node('p','Source evidence: '+(data.stale?'stale; reassessment required.':'current source snapshot.')));
  if(!data.features.length)panel.append(node('p',assessedVerdict(data,null)));
  for(const feature of data.features){
    const section=node('section','');section.className='feature-evidence';
    section.append(node('h3','Feature: '+feature.key),node('strong',assessedVerdict(data,feature)),node('p','Current feature target: '+(feature.current?.appSha||feature.appSha)));
    if(feature.current){
      section.append(node('p','Code: '+feature.current.code+' · Feature: '+feature.current.feature+' · Environment: '+feature.current.environment+' · Test data: '+feature.current.data));
      const blockers=node('ul','');for(const blocker of feature.current.blockers)blockers.append(node('li',blocker));
      if(feature.current.appSha!==data.report.headSha)blockers.append(node('li','No current readiness decision for the assessed application revision.'));
      if(data.stale)blockers.append(node('li','Source evidence changed; reassess before planning tests.'));
      section.append(blockers.childNodes.length?blockers:node('p','No prerequisite blockers recorded for this feature target.'));
    }
    section.append(node('p','Test readiness does not authorise execution. A separately approved plan and configured runner are required.'));
    const history=node('details','');history.className='readiness-history';history.append(node('summary','Prerequisite history (reconstructed)'),node('p',feature.historyNote));
    if(!feature.history.length)history.append(node('p','No reconstructable historical readiness evidence.'));
    for(const event of feature.history){
      const entry=node('div','','history-entry');
      entry.append(node('p',sourceLabel(event.assessmentSource)+' · '+event.dependency.key+' revision '+event.revision+' → '+event.dependency.status),
        node('p',verdict(event.readiness)+' · Code: '+event.readiness.code+' · Environment: '+event.readiness.environment+' · Test data: '+event.readiness.data),
        node('p',event.recordedAt+' · '+event.actor+' · '+event.dependency.explanation,'muted'));
      if(event.readiness.blockers.length)entry.append(node('p','Blockers: '+event.readiness.blockers.join(' ')));
      history.append(entry);
    }
    section.append(history);panel.append(section);
  }
  panel.append(node('h3','Recorded Playwright results'));
  if(!data.runs.length)panel.append(node('p','Execution evidence unavailable: no Playwright result is recorded for this assessment.'));
  for(const run of data.runs){
    const outcome=run.outcome==='passed'?'Passed':run.outcome==='failed'?'Failed':'Environment failure';
    panel.append(node('p',outcome+(run.origin==='trusted-synthetic'?' (synthetic; repository-owned fixture)':' (isolated runner)')),
      node('p','Application revision: '+run.appSha+' · Test revision: '+run.testRevisionSha+' · Environment: '+run.environment+' · Finished: '+run.finishedAt),
      node('p',run.appSha!==data.report.headSha||data.stale?'Recorded result is not current evidence for this assessment.':'Recorded result matches the assessed application revision; it does not by itself establish verified coverage.'),
      node('p','Executed assertion hashes: '+run.assertionHashes.join(', '),'muted'));
  }
  panel.append(node('h3','Verified coverage'),node('p',coverage==='not measured'?'Not measured. A recorded pass is separate from verified acceptance-criterion coverage.':String(coverage)));
}
async function refresh(){try{
  el('detail').replaceChildren();el('detail').hidden=true;
  const [overview,plans]=await Promise.all([api('/api/overview'),api('/api/plans')]);
  el('content').hidden=false;el('metrics').replaceChildren();
  for(const [label,value] of [['Assessments',overview.counts.assessments],['Current sources',overview.counts.sources],['Stale reports',overview.counts.stale],['Verified coverage',overview.verifiedCoverage]]){
    const card=node('div','','metric');card.append(node('span',label,'muted'),node('strong',String(value)));el('metrics').append(card);
  }
  el('reports').replaceChildren();const cache=new Map();let first=true;
  for(const report of overview.reports){
    const row=node('tr','');let data=null;
    try{data=await loadEvidence(report,cache);}catch{}
    const feature=data?.features.length===1?data.features[0]:null;
    for(const text of [sourceLabel(report.source_id)+' · '+report.assessment_id.slice(0,8),data?.report.requirements.map(item=>item.text).join(' · ')||'Requirement evidence unavailable',report.head_sha,report.state,data?assessedVerdict(data,feature):'Readiness unknown: evidence could not be loaded.'])row.append(node('td',text));
    const td=node('td','');const view=node('button','Inspect','secondary');view.disabled=!data;
    view.onclick=()=>showEvidence(data,overview.verifiedCoverage);td.append(view);row.append(td);el('reports').append(row);
    if(first&&data){showEvidence(data,overview.verifiedCoverage);first=false;}
  }
  el('plans').replaceChildren();if(!plans.length)el('plans').append(node('p','No plans are awaiting review.'));
  for(const item of plans.filter(Boolean)){
    const card=node('div','','plan');card.append(node('span',item.approval.status,'badge'),node('h3',item.plan.operation+' · '+item.plan.strategy+' · '+item.plan.environment),node('pre',JSON.stringify({id:item.plan.id,hash:item.hash,plan:item.plan,approval:item.approval},null,2)));
    if(item.plan.operation==='create_pr'){
      const target=item.plan.publication;
      card.append(node('p',target?'Automation destination: '+target.repository+' (ID '+target.repositoryId+') · '+target.baseBranch+'@'+target.baseSha+' · '+target.path:'Publication unavailable: replace this legacy plan with an explicit separate automation repository target and obtain a new approval.'));
      card.append(node('p','Approval permits the exact proposal; it does not publish or merge. Publication requires a separate operator command. Developers review, approve and merge the test PR in the VCS.'));
    }
    const actions=node('div','','actions');for(const [label,decision,cls] of [['Approve for 5 minutes','approved',''],['Reject','rejected','secondary'],['Revoke','revoked','danger']]){
      const button=node('button',label,cls);button.disabled=item.plan.operation==='create_pr'&&!item.plan.publication&&decision==='approved';button.onclick=async()=>{try{await api('/api/plans/'+encodeURIComponent(item.plan.id)+'/decision',{decision});await refresh();}catch(e){message(e.message);}};actions.append(button);
    }
    card.append(actions);el('plans').append(card);
  }
  el('refresh').disabled=false;message('Loaded records for repository '+overview.scope.repositoryId+'. No coverage benchmark is inferred.');
}catch(e){message(e.message);}}
el('connect').onclick=async()=>{token=el('token').value;el('token').value='';el('content').hidden=true;await refresh();};el('refresh').onclick=refresh;
</script></body></html>`;
}
