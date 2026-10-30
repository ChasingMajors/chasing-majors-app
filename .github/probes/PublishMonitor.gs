/* Option B phase 1. Observability only: no content, Sheet or D1 mutations.
 * Private bounded receipts in Script Properties. Dedicated GitHub READ token.
 */
var PUBMON_PREFIX = "CM_PUBMON_JOB_";
var PUBMON_INDEX = "CM_PUBMON_INDEX";
var PUBMON_TERMINAL = ["live_verified", "failed", "cancelled", "overdue", "probe_passed"];
var PUBMON_REPO = "https://api.github.com/repos/ChasingMajors/chasing-majors-app";
var PUBMON_WORKFLOW = ".github/workflows/vault-data.yml";

function pubmonNow_() { return new Date().toISOString(); }
function pubmonLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error("Publish monitoring busy; no publication was retried.");
  try { return fn(); } finally { lock.releaseLock(); }
}
function pubmonIds_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty(PUBMON_INDEX) || "[]");
}
function pubmonRead_(id) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(id))) throw new Error("Invalid publish monitor job ID.");
  var raw = PropertiesService.getScriptProperties().getProperty(PUBMON_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}
function pubmonSave_(job) {
  job.version = Number(job.version || 0) + 1;
  job.updated_at = pubmonNow_();
  var props = PropertiesService.getScriptProperties(), text = JSON.stringify(job);
  if (Utilities.newBlob(text).getBytes().length > 8000) throw new Error("Publish monitor receipt exceeds its storage limit.");
  props.setProperty(PUBMON_PREFIX + job.id, text);
  if (props.getProperty(PUBMON_PREFIX + job.id) !== text) throw new Error("Publish monitor receipt was not durably saved.");
}
function pubmonRegister_(payload) {
  var id = payload.job_id || payload.request_id;
  if (!id) throw new Error("A stable request_id is required for monitored publishing.");
  return pubmonLock_(function() {
    var old = pubmonRead_(id);
    if (old) {
      if (old.code !== String(payload.code || "") || old.kind !== (payload.action === "publishVaultStaticDataToGitHub" ? "prv" : "checklist")) throw new Error("Publish monitor identity conflict.");
      return old;
    }
    var ids = pubmonIds_(), jobs = ids.map(pubmonRead_).filter(Boolean);
    if (jobs.filter(function(j) { return PUBMON_TERMINAL.indexOf(j.state) < 0; }).length >= 30) throw new Error("Publish monitoring queue full; resolve outstanding jobs first.");
    var retain = jobs.filter(function(j) { return PUBMON_TERMINAL.indexOf(j.state) >= 0; }).slice(-20).map(function(j) { return j.id; });
    ids = ids.filter(function(key) {
      var j = pubmonRead_(key);
      if (!j || PUBMON_TERMINAL.indexOf(j.state) >= 0 && retain.indexOf(key) < 0) {
        PropertiesService.getScriptProperties().deleteProperty(PUBMON_PREFIX + key); return false;
      }
      return true;
    });
    var now = pubmonNow_(), job = {id:id, code:String(payload.code || ""), sport:String(payload.sport || "").toLowerCase(), bucket:String(payload.bucket || ""),
      kind:payload.action === "publishVaultStaticDataToGitHub" ? "prv" : "checklist", state:"awaiting_commit", search_state:"not_checked",
      exporter_job_id:payload.job_id || (String(payload.async) === "1" ? id : null),
      base_sha:null, approved_content_hash:null, approval_evidence:"Legacy publisher does not supply a hash-bound approval receipt.",
      submitted_sha:null, release_sha:null, workflow_run_id:null, workflow_attempt:null, deployment_id:null,
      created_at:now, updated_at:now, deadline_at:new Date(Date.now() + 60 * 60000).toISOString(), next_poll_at:now, polls:0, evidence:{}};
    pubmonSave_(job); ids.push(id);
    PropertiesService.getScriptProperties().setProperty(PUBMON_INDEX, JSON.stringify(ids));
    pubmonEnsureTrigger_();
    return job;
  });
}
function pubmonEnsureTrigger_() {
  if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === "runPublishMonitor"; })) {
    ScriptApp.newTrigger("runPublishMonitor").timeBased().everyMinutes(5).create();
  }
}
function pubmonGitHub_(path) {
  if (!/^\/(actions\/|commits\/|contents\/data\/v1\/|deployments|pages)/.test(path) || path.indexOf("..") >= 0) throw new Error("Monitor API path rejected.");
  var token = PropertiesService.getScriptProperties().getProperty("CM_PUBLISH_GITHUB_READ_TOKEN");
  if (!token) throw new Error("Dedicated GitHub read credential not configured.");
  var r = UrlFetchApp.fetch(PUBMON_REPO + path, {headers:{Authorization:"Bearer " + token, Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28"}, muteHttpExceptions:true});
  if (r.getResponseCode() !== 200) throw new Error("GitHub monitoring HTTP " + r.getResponseCode() + ".");
  return JSON.parse(r.getContentText());
}
function pubmonIngest_(job, data) {
  var receipt = data && data.job || {}, result = data && (data.publish_result || data.publish) || {};
  var sha = receipt.commit || data && data.commit || result.commit;
  if (receipt.id) job.exporter_job_id = receipt.id;
  if (sha && /^[a-f0-9]{40}$/.test(sha)) {
    if (job.submitted_sha && job.submitted_sha !== sha) throw new Error("Exporter changed the monitored commit identity.");
    job.submitted_sha = sha; job.release_sha = job.release_sha || sha;
    if (job.state === "awaiting_commit") { job.state = "commit_submitted"; job.committed_at = pubmonNow_(); }
  }
  var expected = data && data.expected || result.expected;
  if (expected) job.expected = {release_id:expected.release_id,content_sha256:expected.content_sha256,row_count:expected.row_count,parallel_count:expected.parallel_count,index_sha256:expected.index_sha256};
  if (receipt.stage === "failed" || data && data.status === "publish_failed") { job.state = "failed"; job.error = "Exporter failed before a verified deployment."; }
}
function pubmonCapture_(payload, data) {
  return pubmonLock_(function() {
    var job = pubmonRead_(payload.job_id || payload.request_id);
    if (!job) throw new Error("Publish monitor receipt missing.");
    if (PUBMON_TERMINAL.indexOf(job.state) < 0) { pubmonIngest_(job, data); pubmonSave_(job); }
    return pubmonPublic_(job);
  });
}
function pubmonPublic_(job) {
  return JSON.parse(JSON.stringify(job)); // Only allowlisted receipt fields; never token/key/payload.
}
function pubmonExporter_(job) {
  var props = PropertiesService.getScriptProperties(), url = props.getProperty("CM_STATIC_EXPORTER_URL");
  if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw new Error("Existing exporter URL is not configured.");
  var payload = {action:job.kind === "prv" ? "publishVaultStaticDataToGitHub" : "publishChecklistAfterImport", job_id:job.id,code:job.code,sport:job.sport,bucket:job.bucket,key:props.getProperty("CM_OPERATOR_KEY")};
  var r = UrlFetchApp.fetch(url,{method:"post",contentType:"text/plain;charset=utf-8",payload:JSON.stringify(payload),muteHttpExceptions:true});
  if (r.getResponseCode() !== 200) throw new Error("Exporter receipt unavailable.");
  var data = JSON.parse(r.getContentText());
  // job_id status reads only. Never enqueue, retry an upload or import here.
  if (!data.job || data.job.id !== job.id) throw new Error("Exporter did not return the expected job receipt.");
  return data;
}
function pubmonRunFailure_(job, run, label) {
  job.run_url = run.html_url;
  job.workflow_run_id = run.id; job.workflow_attempt = run.run_attempt;
  if (run.status !== "completed") return false;
  if (run.conclusion !== "success") {
    job.state = run.conclusion === "cancelled" ? "cancelled" : "failed";
    job.error = label + " concluded " + String(run.conclusion || "without success") + ".";
    return true;
  }
  return false;
}
function pubmonEvaluate_(job, api, verify) {
  if (!job.submitted_sha) return;
  if (!job.base_sha) {
    var commit = api("/commits/" + job.submitted_sha);
    job.base_sha = commit.parents && commit.parents[0] && commit.parents[0].sha || null;
  }
  var workflow = job.probe_only ? "publish-monitor-probe.yml" : "vault-data.yml";
  var workflowPath = job.probe_only ? ".github/workflows/" + workflow : PUBMON_WORKFLOW;
  var runs = api("/actions/workflows/" + workflow + "/runs?head_sha=" + job.submitted_sha + "&per_page=10").workflow_runs || [];
  var run = runs.filter(function(r) { return r.head_sha === job.submitted_sha && r.path === workflowPath && r.event === (job.probe_only ? "workflow_dispatch" : "push") && (!job.probe_run_id || r.id === job.probe_run_id); })
    .sort(function(a,b) { return b.run_number - a.run_number || b.run_attempt - a.run_attempt; })[0];
  if (!run) { job.waiting_for = "Missing matching content workflow; publication is unverified."; return; }
  job.workflow_run_id = run.id; job.workflow_attempt = run.run_attempt; job.run_url = run.html_url;
  if (pubmonRunFailure_(job, run, "Content workflow") || run.status !== "completed") return;
  job.state = "checks_passed"; job.checks_passed_at = job.checks_passed_at || pubmonNow_();
  if (job.probe_only) { job.state = "probe_passed"; job.waiting_for = "Notification probe only; no content or Pages deployment performed."; return; }
  var releaseJobs = api("/actions/runs/" + run.id + "/jobs?per_page=30").jobs || [];
  var artifactMode = releaseJobs.some(function(j) { return j.name === "deploy"; });
  if (artifactMode) {
    var artifacts = api("/actions/runs/" + run.id + "/artifacts?per_page=30").artifacts || [];
    var manifests = artifacts.filter(function(a) { return a.name === "content-release-manifest" && !a.expired && a.workflow_run && a.workflow_run.head_sha === job.submitted_sha; });
    if (manifests.length !== 1) { job.waiting_for = "Missing or ambiguous SHA-bound artifact manifest; held unverified."; return; }
    job.artifact_mode = true; job.artifact_manifest_id = manifests[0].id;
    job.artifact_manifest_size = manifests[0].size_in_bytes;
    job.artifact_manifest_digest = manifests[0].digest; job.release_sha = job.submitted_sha;
    var artifactDeployments = api("/deployments?sha=" + job.submitted_sha + "&environment=github-pages&per_page=10");
    var artifactDeployment = artifactDeployments.filter(function(d) { return d.sha === job.submitted_sha && d.environment === "github-pages"; }).sort(function(a,b) { return b.id-a.id; })[0];
    if (!artifactDeployment) { job.waiting_for = "No SHA-matched artifact Pages deployment."; return; }
    job.deployment_id = artifactDeployment.id;
    var artifactStatuses = api("/deployments/" + artifactDeployment.id + "/statuses?per_page=10");
    var artifactStatus = artifactStatuses[0];
    if (!artifactStatus) return;
    if (["failure","error"].indexOf(artifactStatus.state) >= 0) { job.state="failed"; job.error="Artifact Pages deployment failed."; return; }
    if (artifactStatus.state !== "success") return;
    job.state="pages_deployed"; job.pages_deployed_at=job.pages_deployed_at||pubmonNow_();
    var artifactLive=verify(job);job.evidence.live=artifactLive;
    if (artifactLive.ok && artifactLive.release_sha===job.submitted_sha && artifactLive.deployed_sha===job.submitted_sha) {
      job.state="live_verified";job.live_verified_at=pubmonNow_();job.search_state="pending";delete job.waiting_for;
    } else job.waiting_for=artifactLive.reason||"Artifact live SHA/content is not verified.";
    return;
  }
  var build = api("/pages/builds/latest");
  var release = build.commit;
  if (!/^[a-f0-9]{40}$/.test(release || "")) return;
  if (release !== job.submitted_sha) {
    // Accept only a direct CI-generated successor linked to THIS workflow run.
    var successor = api("/commits/" + release);
    var jobs = api("/actions/runs/" + run.id + "/jobs?per_page=30").jobs || [];
    var push = jobs.filter(function(j) { return j.name === "refresh"; })[0];
    if (!successor.parents || successor.parents.length !== 1 || successor.parents[0].sha !== job.submitted_sha ||
        !successor.commit || successor.commit.message.trim() !== "Refresh structured Vault data" ||
        !successor.author || successor.author.login !== "github-actions[bot]" || !push ||
        Date.parse(successor.commit.committer.date) < Date.parse(push.started_at) || Date.parse(successor.commit.committer.date) > Date.parse(push.completed_at)) {
      job.waiting_for = "Latest Pages build is unrelated or successor lineage is ambiguous; held unverified."; return;
    }
    job.evidence.successor_parent_sha = job.submitted_sha;
  }
  job.release_sha = release;
  if (build.status === "errored") { job.state = "failed"; job.error = "Pages build failed."; return; }
  if (build.status !== "built") return;
  var deployments = api("/deployments?sha=" + release + "&environment=github-pages&per_page=10");
  var deployment = deployments.filter(function(d) { return d.sha === release && d.environment === "github-pages"; }).sort(function(a,b) { return b.id - a.id; })[0];
  if (!deployment) { job.waiting_for = "No SHA-matched Pages deployment."; return; }
  job.deployment_id = deployment.id;
  var states = api("/deployments/" + deployment.id + "/statuses?per_page=10");
  var status = states[0];
  if (!status) return;
  if (["failure","error"].indexOf(status.state) >= 0) { job.state = "failed"; job.error = "Pages deployment " + status.state + "."; return; }
  if (status.state !== "success") return;
  job.state = "pages_deployed"; job.pages_deployed_at = job.pages_deployed_at || pubmonNow_();
  var live = verify(job);
  job.evidence.live = live;
  if (live.ok && live.release_sha === job.submitted_sha && live.deployed_sha === release) {
    job.state = "live_verified"; job.live_verified_at = pubmonNow_(); job.search_state = "pending"; delete job.waiting_for;
  } else job.waiting_for = live.reason || "Live release manifest/content not verified.";
}
function pubmonStable_(v) {
  if (Array.isArray(v)) return "[" + v.map(pubmonStable_).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter(function(k) { return v[k] !== undefined; }).sort().map(function(k) { return JSON.stringify(k) + ":" + pubmonStable_(v[k]); }).join(",") + "}";
  return JSON.stringify(v);
}
function pubmonHash_(v) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,pubmonStable_(v),Utilities.Charset.UTF_8).map(function(n) { return (n & 255).toString(16).padStart(2,"0"); }).join("");
}
function pubmonProductHash_(product) {
  var meta = Object.assign({},product.meta || {});
  ["release_id","content_sha256","expected_rows","expected_parallels"].forEach(function(k) { delete meta[k]; });
  var data = {meta:meta,rows:product.rows || []};
  if (Array.isArray(product.parallels)) data.parallels = product.parallels;
  return pubmonHash_(data);
}
function pubmonJson_(path, sha) {
  if (!/^data\/v1\/[a-zA-Z0-9_./-]+\.json$/.test(path) || path.indexOf("..") >= 0) throw new Error("Invalid content evidence path.");
  if (sha) {
    var file = pubmonGitHub_("/contents/" + path + "?ref=" + sha);
    if (file.encoding !== "base64" || !file.content) throw new Error("GitHub content evidence unavailable.");
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(file.content)).getDataAsString());
  }
  var r = UrlFetchApp.fetch("https://app.chasingmajors.com/" + path + "?pubmon=" + Date.now(),{muteHttpExceptions:true});
  if (r.getResponseCode() !== 200) throw new Error("Live JSON evidence unavailable.");
  return JSON.parse(r.getContentText());
}
function pubmonProductEvidence_(job, sha) {
  var dir = job.kind === "prv" ? "data/v1/vault/" : "data/v1/checklists/";
  var index = pubmonJson_(dir + "index.json",sha);
  var entries = (index.index || []).filter(function(row) { return (row.Code || row.code) === job.code; });
  if (entries.length !== 1) throw new Error("Product index identity is absent or ambiguous.");
  if (!/^[a-z]+$/.test(job.sport)) throw new Error("Product sport evidence invalid.");
  var manifest = pubmonJson_(dir + "products/" + (job.kind === "prv" ? "all" : job.sport) + ".json",sha);
  var file = manifest.product_map && manifest.product_map[job.code];
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(file || "")) throw new Error("Product payload location unavailable.");
  var product = (pubmonJson_(dir + "products/" + file,sha).products || {})[job.code];
  if (!product || !product.meta || product.meta.code !== job.code || !Array.isArray(product.rows) || String(product.meta.sport).toLowerCase() !== job.sport) throw new Error("Product payload identity invalid.");
  return {index:index,product:product,index_row:entries[0]};
}
function pubmonLive_(job) {
  if (job.artifact_mode) return pubmonLiveArtifact_(job);
  // Require publisher-supplied SHA evidence. Existing time stamps/release UUIDs
  // are NOT substitutes. This phase must not silently alter content publishing.
  if (!job.expected) {
    // Read the exact submitted commit, never a newer branch or search record.
    var pinned = pubmonProductEvidence_(job,job.submitted_sha), original = pinned.product;
    job.expected = {release_id:original.meta.release_id || null,content_sha256:pubmonProductHash_(original),row_count:original.rows.length,
      parallel_count:Array.isArray(original.parallels) ? original.parallels.length : undefined,index_sha256:pubmonHash_(pinned.index_row)};
  }
  var evidence = pubmonProductEvidence_(job,null), product = evidence.product, manifest = evidence.index;
  var sha = manifest.release_sha || manifest.commit_sha;
  if (sha !== job.submitted_sha) return {ok:false,reason:"Live manifest has no matching source release SHA; publication remains unverified."};
  var expected = job.expected;
  var actualHash = pubmonProductHash_(product), parallels = Array.isArray(product.parallels) ? product.parallels.length : undefined;
  var ok = (product.meta.release_id || null) === expected.release_id && actualHash === expected.content_sha256 && product.rows.length === expected.row_count &&
    (job.kind === "prv" || parallels === expected.parallel_count) && (!expected.index_sha256 || pubmonHash_(evidence.index_row) === expected.index_sha256);
  return {ok:!!ok,release_sha:sha,deployed_sha:job.release_sha,content_sha256:actualHash,row_count:product.rows.length,parallel_count:parallels};
}

// Download ONLY the small release-manifest ZIP, never the full Pages artifact.
// Signed storage redirects get a fresh request WITHOUT the GitHub Authorization header.
function pubmonArtifactManifest_(job) {
  if (!Number.isSafeInteger(job.artifact_manifest_id) || !/^sha256:[a-f0-9]{64}$/.test(job.artifact_manifest_digest||"")) throw new Error("Artifact manifest digest unavailable.");
  if (!Number.isSafeInteger(job.artifact_manifest_size) || job.artifact_manifest_size<1 || job.artifact_manifest_size>4*1024*1024) throw new Error("Artifact manifest size unavailable or over budget.");
  var token=PropertiesService.getScriptProperties().getProperty("CM_PUBLISH_GITHUB_READ_TOKEN");
  if (!token) throw new Error("Dedicated GitHub read credential not configured.");
  var response=UrlFetchApp.fetch(PUBMON_REPO+"/actions/artifacts/"+job.artifact_manifest_id+"/zip",{headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json"},followRedirects:false,muteHttpExceptions:true});
  if (response.getResponseCode()===302) {
    var headers=response.getAllHeaders(),location=headers.Location||headers.location||"";
    if (!/^https:\/\/[a-zA-Z0-9.-]+\.(?:blob\.core\.windows\.net|actions\.githubusercontent\.com)\//.test(location)) throw new Error("Artifact storage redirect rejected.");
    response=UrlFetchApp.fetch(location,{followRedirects:false,muteHttpExceptions:true});
  }
  if (response.getResponseCode()!==200) throw new Error("Artifact manifest ZIP unavailable.");
  var blob=response.getBlob(),bytes=blob.getBytes();
  if (bytes.length>4*1024*1024) throw new Error("Artifact manifest ZIP exceeds bounded limit.");
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(n){return(n&255).toString(16).padStart(2,"0");}).join("");
  if ("sha256:"+digest!==job.artifact_manifest_digest) throw new Error("Artifact archive digest mismatch.");
  var files=Utilities.unzip(blob);if(files.length!==1||files[0].getName()!=="publish-release.json"||files[0].getBytes().length>3*1024*1024)throw new Error("Invalid artifact manifest ZIP contents.");
  var text=files[0].getDataAsString("UTF-8"),manifest=JSON.parse(text);
  if(manifest.release_sha!==job.submitted_sha||manifest.schema_version!==1)throw new Error("Artifact source SHA mismatch.");
  return {manifest:manifest,hash:pubmonTextHash_(text)};
}
function pubmonTextHash_(text){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8).map(function(n){return(n&255).toString(16).padStart(2,"0");}).join("");}
function pubmonFetchReleaseJson_(path){
  if(!/^data\/[a-zA-Z0-9_./-]+\.json$/.test(path)||path.indexOf("..")>=0)throw new Error("Unsafe release evidence path.");
  var response=UrlFetchApp.fetch("https://app.chasingmajors.com/"+path+"?pubmon="+Date.now(),{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error("Live artifact JSON unavailable.");
  var text=response.getContentText();return {json:JSON.parse(text),hash:pubmonTextHash_(text)};
}
function pubmonLiveArtifact_(job){
  var expected=pubmonArtifactManifest_(job),manifest=expected.manifest,live=pubmonFetchReleaseJson_("data/publish-release.json");
  if(live.json.release_sha!==job.submitted_sha||live.hash!==expected.hash)return {ok:false,reason:"Live artifact differs from SHA-bound submitted artifact."};
  var kind=job.kind==="prv"?"PRV":"CV",products=(manifest.products||[]).filter(function(p){return p.kind===kind&&p.code===job.code&&p.sport===job.sport;});
  if(products.length!==1)return {ok:false,reason:"Submitted product is not uniquely asserted by the artifact manifest."};
  var record=products[0],payload=pubmonFetchReleaseJson_(record.path).json,product=record.container?(payload.products||{})[job.code]:payload;
  if(!product||!Array.isArray(product.rows)||product.rows.length!==record.rows||(Array.isArray(product.parallels)?product.parallels.length:null)!==record.parallels||pubmonTextHash_(JSON.stringify(product))!==record.content_sha256)return {ok:false,reason:"Live product count/parallel/hash mismatch."};
  var paths=["data/v1/checklists/index.json","data/v1/vault/index.json","data/v2/vault/index.json","data/search-delivery.json","data/search-query/index.json"];
  for(var i=0;i<paths.length;i++){var entries=(manifest.files||[]).filter(function(e){return e.path===paths[i];}),actual=pubmonFetchReleaseJson_(paths[i]);if(entries.length!==1||entries[0].sha256!==actual.hash||actual.json.release_sha!==job.submitted_sha)return {ok:false,reason:"Live index SHA/hash mismatch: "+paths[i]};}
  return {ok:true,release_sha:job.submitted_sha,deployed_sha:job.release_sha,manifest_artifact_id:job.artifact_manifest_id,row_count:record.rows,parallel_count:record.parallels};
}
function pubmonAlert_(job) {
  if (["failed","cancelled","overdue"].indexOf(job.state) < 0 || job.alert_claimed_at) return;
  var props = PropertiesService.getScriptProperties(), to = props.getProperty("CM_SENTINEL_ALERT_EMAIL");
  if (!to) { job.alert_status = "blocked_missing_recipient"; return; }
  if (MailApp.getRemainingDailyQuota() < 1) { job.alert_status = "blocked_mail_quota"; return; }
  // Claim-before-send prevents duplicate email after a crash. Uncertain delivery
  // stays visible, never represented as delivered; native GitHub email is fallback.
  job.alert_claimed_at = pubmonNow_(); job.alert_status = "delivery_unconfirmed"; pubmonSave_(job);
  try {
    MailApp.sendEmail(to, "[CM publish " + job.state + "] " + job.code,
      "Job: " + job.id + "\nState: " + job.state + "\nSHA: " + (job.submitted_sha || "not confirmed") + "\n" + (job.error || job.waiting_for || "Publish not verified") + "\n" + (job.run_url || "https://github.com/ChasingMajors/chasing-majors-app/actions") + "\nNo content retry was performed.");
    job.alert_status = "sent"; job.alert_sent_at = pubmonNow_();
  } catch (_) { job.alert_status = "delivery_unconfirmed"; }
}
function pubmonPoll_(job) {
  if (PUBMON_TERMINAL.indexOf(job.state) >= 0 || Date.now() < Date.parse(job.next_poll_at)) return job;
  job.polls++; job.last_polled_at = pubmonNow_();
  job.next_poll_at = new Date(Date.now() + Math.min(15, Math.pow(2, Math.min(job.polls - 1,4))) * 60000).toISOString();
  var attemptVersion = pubmonLock_(function() {
    var current = pubmonRead_(job.id);
    if (current && current.version !== job.version) return null;
    pubmonSave_(job); return job.version;
  }); // durable attempt before requests
  if (attemptVersion === null) return pubmonRead_(job.id);
  try { if (job.exporter_job_id) pubmonIngest_(job,pubmonExporter_(job)); if (PUBMON_TERMINAL.indexOf(job.state) < 0) pubmonEvaluate_(job,pubmonGitHub_,pubmonLive_); }
  catch (_) { job.monitor_error = "Monitoring unavailable; verify read credential, permissions and service access."; }
  if (PUBMON_TERMINAL.indexOf(job.state) < 0 && Date.now() >= Date.parse(job.deadline_at)) {
    job.state = "overdue"; job.error = job.waiting_for || job.monitor_error || "No verified release within one hour.";
  }
  return pubmonLock_(function() {
    var current = pubmonRead_(job.id);
    if (current && current.version !== attemptVersion) return current;
    pubmonSave_(job); return job;
  });
}
function runPublishMonitor() {
  // Short lease: never hold Sentinel's import lock during network requests.
  var lease = pubmonLock_(function() {
    var props = PropertiesService.getScriptProperties();
    if (Number(props.getProperty("CM_PUBMON_LEASE_UNTIL") || 0) > Date.now()) return false;
    var until = String(Date.now() + 360000);
    props.setProperty("CM_PUBMON_LEASE_UNTIL",until);
    if (props.getProperty("CM_PUBMON_LEASE_UNTIL") !== until) throw new Error("Publish monitor lease not durable.");
    return until;
  });
  if (!lease) return {ok:true,checked:0,busy:true};
  try {
    var start = Date.now(), jobs = pubmonIds_().map(pubmonRead_).filter(Boolean), checked = 0;
    jobs.sort(function(a,b) { return Date.parse(a.next_poll_at) - Date.parse(b.next_poll_at); });
    jobs.forEach(function(job) {
      if (checked < 3 && Date.now() - start < 90000 && PUBMON_TERMINAL.indexOf(job.state) < 0 && Date.now() >= Date.parse(job.next_poll_at)) { job = pubmonPoll_(job); checked++; }
      pubmonLock_(function() {
        var current = pubmonRead_(job.id);
        // Concurrent exporter response wins over a stale polling receipt.
        if (current && current.version !== job.version) job = current;
        pubmonAlert_(job); pubmonSave_(job);
      });
    });
    if (!jobs.some(function(j) { return PUBMON_TERMINAL.indexOf(j.state) < 0 || ["blocked_mail_quota","blocked_missing_recipient"].indexOf(j.alert_status) >= 0; })) {
      ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === "runPublishMonitor"; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
    }
    return {ok:true,checked:checked};
  } finally {
    pubmonLock_(function() {
      var props = PropertiesService.getScriptProperties();
      if (props.getProperty("CM_PUBMON_LEASE_UNTIL") === lease) props.deleteProperty("CM_PUBMON_LEASE_UNTIL");
    });
  }
}
function publishMonitorStatus_(body) {
  requireOperatorKey_(body.key);
  runPublishMonitor();
  return {ok:true,jobs:pubmonIds_().map(pubmonRead_).filter(Boolean).map(pubmonPublic_),updated_at:pubmonNow_()};
}

// Owner/editor-only setup diagnostics. Never returns credentials or starts a publish.
function publishMonitorSetupStatus() {
  var props = PropertiesService.getScriptProperties();
  var result = {read_token_configured:!!props.getProperty("CM_PUBLISH_GITHUB_READ_TOKEN"),
    alert_recipient_configured:!!props.getProperty("CM_SENTINEL_ALERT_EMAIL"),mail_quota:MailApp.getRemainingDailyQuota(),
    active_jobs:pubmonIds_().map(pubmonRead_).filter(function(j) { return j && PUBMON_TERMINAL.indexOf(j.state) < 0; }).length};
  if (result.read_token_configured) {
    try {
      pubmonGitHub_("/actions/workflows/vault-data.yml");
      pubmonGitHub_("/pages/builds/latest");
      pubmonGitHub_("/deployments?environment=github-pages&per_page=1");
      result.read_api_verified = true;
    } catch (_) { result.read_api_verified = false; }
  }
  Logger.log(JSON.stringify(result)); return result;
}

// Owner/editor-only: observe an actual isolated probe run selected in a private
// property. This cannot dispatch anything, publish content or claim Live verified.
function publishMonitorObserveProbe() {
  var runId = String(PropertiesService.getScriptProperties().getProperty("CM_PUBMON_PROBE_RUN_ID") || "");
  if (!runId) {
    var recent = (pubmonGitHub_("/actions/workflows/publish-monitor-probe.yml/runs?event=workflow_dispatch&per_page=5").workflow_runs || []).filter(function(r) {
      return r.event === "workflow_dispatch" && r.actor && r.actor.login === "ChasingMajors" && Date.now() - Date.parse(r.created_at) < 86400000;
    });
    if (recent.length) runId = String(recent[0].id);
  }
  if (!/^\d+$/.test(runId)) throw new Error("No recent owner-dispatched probe. Set CM_PUBMON_PROBE_RUN_ID to a real probe run ID.");
  var run = pubmonGitHub_("/actions/runs/" + runId);
  if (run.path !== ".github/workflows/publish-monitor-probe.yml" || run.event !== "workflow_dispatch") throw new Error("Not an isolated monitor probe run.");
  var id = "notification-probe-" + runId;
  pubmonRegister_({request_id:id,action:"publishChecklistAfterImport",code:"NON-PRODUCTION-NOTIFICATION-PROBE"});
  pubmonLock_(function() {
    var job = pubmonRead_(id);
    if (PUBMON_TERMINAL.indexOf(job.state) < 0) {
      job.probe_only = true; job.probe_run_id = run.id; job.submitted_sha = run.head_sha; job.release_sha = run.head_sha;
      job.state = "commit_submitted"; pubmonSave_(job);
    }
  });
  runPublishMonitor();
  var result = pubmonPublic_(pubmonRead_(id));
  Logger.log(JSON.stringify({state:result.state,email:result.alert_status || "not_needed",polls:result.polls,run_url:result.run_url,id:result.id})); return result;
}

// Read-only acceptance check against the existing, approved Holiday Football
// product. This observes a real release; it does NOT publish or approve content.
function publishMonitorVerifyCurrentHolidayRelease() {
  var manifest = pubmonJson_("data/v1/checklists/index.json",null), sha = manifest.release_sha;
  if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("Live source-SHA metadata is not present yet.");
  var id = "observe-holiday-" + sha.slice(0,20);
  pubmonRegister_({request_id:id,action:"publishChecklistAfterImport",code:"2026_topps_holiday_football",sport:"football",bucket:"2026"});
  pubmonLock_(function() {
    var job = pubmonRead_(id);
    if (PUBMON_TERMINAL.indexOf(job.state) < 0) {
      job.observation_only = true; job.submitted_sha = sha; job.release_sha = sha; job.state = "commit_submitted";
      pubmonSave_(job);
    }
  });
  runPublishMonitor();
  var result = pubmonPublic_(pubmonRead_(id));
  if (result.state === "live_verified" && (result.evidence.live.row_count !== 763 || result.evidence.live.parallel_count !== 83)) throw new Error("Observed Holiday Football baseline counts changed; inspect before acceptance.");
  Logger.log(JSON.stringify({state:result.state,live:result.evidence.live || null,polls:result.polls,run_url:result.run_url,id:result.id})); return result;
}
