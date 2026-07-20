// compile.mjs — single source of truth for compiling an op-annotated cases.yaml
// step into an IR v2 step (see compile-ir.md). Shared by run-case.mjs (live
// execution) and recompile-ir.mjs (offline rebuild) so the two can never drift.
//
// Design constraints (learned from real offline replays against aqa-runner):
//  - aqa-runner's expect() is STRICT: a locator that resolves to 2+ elements
//    fails immediately. Text-presence asserts therefore compile to
//    `text_contains` on the unique `body` element, never to a bare text
//    selector ("CPU" can match once per table row).
//  - aqa-runner's `url_matches` checks page.url() ONCE, with no retry. A
//    client-side redirect (e.g. an auth guard bouncing to the login page) races
//    it, so a URL assert that targets the login path is preceded by an
//    auto-waiting `visible` assert on the login form.
//  - IR v2 has NO `attr_equals` assert (the runner throws "Unknown assert
//    type"). Attribute checks compile to a CSS attribute selector + `visible`.
//  - Secrets never appear in the IR: sensitive fills emit `value_ref` (the
//    test_data key), and the login expansion always refs the password key.

/** Resolve the file-level `login:` config with generic defaults. */
export function loginConfig(doc) {
  const cfg = doc?.login ?? {};
  return {
    path: cfg.path ?? '/login',
    username_selector: cfg.username_selector ?? 'input[name=username]',
    password_selector: cfg.password_selector ?? 'input[name=password]',
    // Regex source matched against the submit control's accessible name.
    submit_text: cfg.submit_text ?? 'Sign in|Log in|Login',
    // Regex source matched against the logout menu item's accessible name.
    logout_text: cfg.logout_text ?? 'Sign out|Log out|Logout',
    id_key: cfg.id_key ?? 'auth_id',
    password_key: cfg.password_key ?? 'auth_password',
  };
}

export const substitute = (s, td) =>
  typeof s === 'string' ? s.replace(/\$\{(\w+)\}/g, (_, k) => (td[k] ?? '')) : s;

/**
 * IR expansion of the `login` op.
 * `submitName` is the accessible name of the submit control as observed by the
 * live run (captured by run-case.mjs). Falls back to the first literal
 * alternative of the configured submit_text pattern.
 */
export function loginIR(td, login, submitName) {
  return [
    { op: 'goto', url: `${td.BASE_URL}${login.path}` },
    { op: 'fill', selector: { strategy: 'css', css: login.username_selector }, value: td[login.id_key] ?? '' },
    { op: 'fill', selector: { strategy: 'css', css: login.password_selector }, value_ref: login.password_key, sensitive: true },
    { op: 'click', selector: { strategy: 'role', role: 'button', name: submitName || login.submit_text.split('|')[0] } },
    // Settles the post-login redirect offline: expect() retries until the
    // login form is gone, so the next step never races the session cookie.
    { op: 'assert', assert: { type: 'hidden', selector: { strategy: 'css', css: login.password_selector } } },
  ];
}

/**
 * Compile one op-annotated step into IR v2 step(s). Returns an array (a step
 * may compile to more than one IR step, e.g. a settled URL assert), or null
 * for ops that have no offline form (`manual`) or are expanded elsewhere
 * (`login` → loginIR).
 */
export function compileStep(step, td, login) {
  const sel = step.selector
    ? Object.fromEntries(Object.entries(step.selector).map(([k, v]) => [k, substitute(v, td)]))
    : undefined;
  const valOrRef = () =>
    step.sensitive
      ? { value_ref: (String(step.value ?? '').match(/^\$\{(\w+)\}$/)?.[1]) ?? login.password_key, sensitive: true }
      : { value: substitute(step.value, td) };

  switch (step.op) {
    case 'goto':
      return [{ op: 'goto', url: substitute(step.value, td) }];
    case 'fill':
      return [{ op: 'fill', selector: sel, ...valOrRef() }];
    case 'click':
      return [{ op: 'click', selector: sel }];
    case 'click_text':
      return [{ op: 'click', selector: { strategy: 'text', text: substitute(step.value, td) } }];
    case 'download':
      // Offline replay clicks the control; the download event itself is a
      // live-only signal, so the click is the strongest compilable form.
      return [{ op: 'click', selector: sel ?? { strategy: 'text', text: substitute(step.value, td) } }];
    case 'assert_text':
      // Strict-safe + auto-retrying: `body` is unique, toContainText waits.
      return [{ op: 'assert', assert: { type: 'text_contains', selector: { strategy: 'css', css: 'body' }, expected: substitute(step.expect, td) } }];
    case 'assert_not_text':
      return [{ op: 'assert', assert: { type: 'hidden', selector: { strategy: 'text', text: substitute(step.expect, td) } } }];
    case 'assert_url': {
      const expected = substitute(step.expect, td);
      const out = [];
      if (login.path && expected.includes(login.path)) {
        // Redirect-to-login assert: settle the client-side redirect first.
        out.push({ op: 'assert', assert: { type: 'visible', selector: { strategy: 'css', css: login.password_selector } } });
      }
      out.push({ op: 'assert', assert: { type: 'url_matches', expected } });
      return out;
    }
    case 'assert_visible':
      return [{ op: 'assert', assert: { type: 'visible', selector: sel } }];
    case 'assert_attr': {
      // No attr_equals in IR v2 — compile to a CSS attribute selector +
      // visible. href keeps substring semantics ([attr*=]); everything else
      // is strict equality ([attr=]).
      const want = substitute(step.expect, td);
      const attrSel = step.attr === 'href'
        ? `[href*=${JSON.stringify(want)}]`
        : `[${step.attr}=${JSON.stringify(want)}]`;
      let css;
      if (sel?.strategy === 'css') css = `${sel.css}${attrSel}`;
      else if (sel?.strategy === 'text') css = `${attrSel}:has-text(${JSON.stringify(sel.text)})`;
      else css = attrSel;
      return [{ op: 'assert', assert: { type: 'visible', selector: { strategy: 'css', css } } }];
    }
    case 'login':   // expanded via loginIR by the caller
    case 'logout':  // live-only session teardown; no offline form
    case 'manual':  // never compiled
      return null;
    default:
      return null;
  }
}

/**
 * Pure rebuild of the full IR case list: every case whose current results.csv
 * status is `pass`, compiled straight from the case definition (no browser).
 * This is the union rule from compile-ir.md — a subset rerun must never drop
 * previously-passing cases from the IR.
 */
export function compileIRCases(doc, passIds, submitNames = new Map()) {
  const login = loginConfig(doc);
  const out = [];
  for (const c of doc.cases) {
    if (!passIds.has(c.case_id)) continue;
    const td = c.test_data || {};
    const steps = [];
    for (const step of c.steps) {
      if (step.op === 'login') { steps.push(...loginIR(td, login, submitNames.get(c.case_id))); continue; }
      const ir = compileStep(step, td, login);
      if (ir) steps.push(...ir);
    }
    if (steps.length) {
      out.push({ case_id: c.case_id, name: c.name, steps, cleanup: c.cleanup || [{ type: 'clear_cookies' }] });
    }
  }
  return out;
}
