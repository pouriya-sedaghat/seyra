// Verdict of a browser audit. Every claimed condition is a named check; the run passes only if all
// of them pass, so no recorded failure category can be left out of the exit status.
//
//   external_requests   no request leaves the ingress origin (data:/blob: excepted)
//   rtl_plugin          no RTL-text plugin is fetched
//   failed_requests     no HTTP >= 400 response and no network failure (client aborts excepted)
//   console_errors      no console error
//   required_visits     every required visit reached its selected feature (`reached: true`, proven by
//                       the viewport, see browser-navigation.mjs); a found card alone is not enough
//   script_completed    the audit script ran to its end (a crash is a FAIL with a report)
//
// `required_visits` is a navigation precondition (the screenshot shows the intended area), not a
// search-quality judgement: which rank the intended area had stays an exploratory observation and
// is not owner acceptance.
// `expectedVisits` is how many required visits the audit declares; fewer recorded visits (for
// example a script that stopped early) is a failure, not a vacuous pass.
export function browserVerdict({ external = [], rtlPlugin = [], failed = [], consoleErrors = [], visits = [], expectedVisits, scriptError = null }) {
  if (!Number.isInteger(expectedVisits) || expectedVisits < 0) throw new Error('expectedVisits must be declared');
  const required = visits.filter((v) => v.required !== false);
  const missing = required.filter((v) => v.reached !== true);
  for (let i = required.length; i < expectedVisits; i++) missing.push({ area: `declared visit ${i + 1} not recorded` });
  const checks = {
    external_requests: { ok: external.length === 0, count: external.length },
    rtl_plugin: { ok: rtlPlugin.length === 0, count: rtlPlugin.length },
    failed_requests: { ok: failed.length === 0, count: failed.length },
    console_errors: { ok: consoleErrors.length === 0, count: consoleErrors.length },
    required_visits: { ok: missing.length === 0, required: Math.max(required.length, expectedVisits), missing: missing.map((v) => v.area ?? v.q ?? '?') },
    script_completed: { ok: !scriptError, error: scriptError },
  };
  const ok = Object.values(checks).every((c) => c.ok);
  return { status: ok ? 'PASS' : 'FAIL', ok, checks };
}

export function verdictLine(v) {
  const c = v.checks;
  return `${v.status} external=${c.external_requests.count} rtl_plugin=${c.rtl_plugin.count} failed=${c.failed_requests.count} console_errors=${c.console_errors.count} required_visits=${c.required_visits.required - c.required_visits.missing.length}/${c.required_visits.required}${c.required_visits.missing.length ? ` missing=[${c.required_visits.missing.join('; ')}]` : ''}${c.script_completed.ok ? '' : ` script_error=${JSON.stringify(c.script_completed.error)}`}`;
}
