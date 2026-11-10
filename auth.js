// ClutchMetrics accounts.
// With a Firebase project in firebase-config.js: real accounts (sign up, sign in, forgot password, sign out),
// each user's role (coach or player) saved in Firestore, dashboards open only for that role.
// Without one: the old front-end demo (any email, any password of 6+ characters).
import { firebaseReady } from './firebase-config.js';

// Login-page animations (SVG scenes): with reduced motion, rest on a finished frame instead of looping
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelectorAll('svg.scene').forEach((s) => { s.setCurrentTime(7.2); s.pauseAnimations(); });
}

const fb = firebaseReady ? await import('./firebase.js') : null;
const DEMO_KEY = 'clutchmetrics-session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const dashboardFor = (role) => `${role}-dashboard.html`;
const loginFor = (role) => `login-${role}.html`;

const demo = {
  read() {
    for (const area of [sessionStorage, localStorage]) {
      try { const raw = area.getItem(DEMO_KEY); if (raw) return JSON.parse(raw); } catch { /* storage blocked */ }
    }
    return null;
  },
  write(session, remember) {
    try { (remember ? localStorage : sessionStorage).setItem(DEMO_KEY, JSON.stringify(session)); return true; } catch { return false; }
  },
  clear() { for (const area of [sessionStorage, localStorage]) { try { area.removeItem(DEMO_KEY); } catch { /* blocked */ } } },
};

// ---------------------------------------------------------------- shared form helpers
function formTools(form) {
  const status = form.querySelector('[data-status]');
  const submit = form.querySelector('.submit');
  const label = submit.querySelector('.submit__label');
  const idle = label.textContent;
  const setError = (input, msg) => {
    const out = document.getElementById(`${input.id}-error`);
    if (out) out.textContent = msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };
  const say = (msg, isError) => { status.classList.toggle('is-error', Boolean(isError)); status.textContent = msg; };
  const busy = (on, text) => {
    if (on) { submit.setAttribute('aria-busy', 'true'); label.textContent = text; } else { submit.removeAttribute('aria-busy'); label.textContent = idle; }
  };
  form.querySelectorAll('.reveal').forEach((reveal) => reveal.addEventListener('click', () => {
    const input = reveal.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    reveal.textContent = show ? 'Hide' : 'Show';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));
  return { setError, say, busy };
}

// checks every field; errors then update while the user fixes them
function validate(fields, setError) {
  const problems = fields.map(([input, check]) => {
    const msg = check(input);
    setError(input, msg);
    if (!input.dataset.live) {
      input.dataset.live = '1';
      input.addEventListener('input', () => { if (input.getAttribute('aria-invalid')) setError(input, check(input)); });
    }
    return msg ? input : null;
  }).filter(Boolean);
  return problems;
}

const checkEmail = (input) => {
  const v = input.value.trim();
  if (!v) return 'Enter your email address.';
  return EMAIL_RE.test(v) ? '' : 'Enter an email address with an @ and a domain, like name@team.com.';
};

// ---------------------------------------------------------------- sign-in page
const signinForm = document.querySelector('[data-signin]');
if (signinForm) {
  const role = signinForm.dataset.signin;
  const email = signinForm.querySelector('#email');
  const password = signinForm.querySelector('#password');
  const remember = signinForm.querySelector('#remember');
  const { setError, say, busy } = formTools(signinForm);
  const minLen = fb ? 1 : 6;
  const checkPassword = (input) => (!input.value ? 'Enter your password.' : input.value.length < minLen ? `Use at least ${minLen} characters.` : '');
  document.querySelectorAll('[data-demo-note]').forEach((el) => { el.hidden = Boolean(fb); });
  document.querySelectorAll('[data-signup-line]').forEach((el) => { el.hidden = !fb; });

  // already signed in with this role: go straight through
  if (fb) {
    fb.currentUser().then(async (user) => { if (user && await fb.roleOf(user) === role) location.replace(dashboardFor(role)); });
  } else {
    const existing = demo.read();
    if (existing && existing.role === role) location.replace(dashboardFor(role));
  }

  signinForm.querySelector('[data-forgot]').addEventListener('click', async () => {
    if (!fb) { say('Password reset opens when real accounts launch. For the demo, use any email and a password of 6 or more characters.'); return; }
    const msg = checkEmail(email);
    if (msg) { setError(email, msg); say('Type your email above first, then select "Forgot password?" again.', true); email.focus(); return; }
    try {
      await fb.resetPassword(email.value.trim());
    } catch (err) {
      if (err?.code === 'auth/invalid-email' || err?.code === 'auth/network-request-failed' || err?.code === 'auth/too-many-requests') { say(fb.message(err), true); return; }
    }
    // the same answer whether or not the email has an account, so nobody can test which emails are registered
    say(`If an account exists for ${email.value.trim()}, a password reset link is on its way. Check your inbox and spam folder.`);
  });

  signinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signinForm.querySelector('.submit').getAttribute('aria-busy') === 'true') return;
    const problems = validate([[email, checkEmail], [password, checkPassword]], setError);
    if (problems.length) { say(problems.length === 1 ? 'Fix 1 field to sign in.' : `Fix ${problems.length} fields to sign in.`, true); problems[0].focus(); return; }
    say('Signing in…');
    busy(true, 'Signing in…');
    if (!fb) {
      await new Promise((r) => setTimeout(r, 700));
      if (!demo.write({ role, email: email.value.trim(), at: Date.now() }, remember.checked)) {
        busy(false); say('Your browser is blocking site storage, so the demo cannot keep you signed in. Allow site data and try again.', true); return;
      }
      location.href = dashboardFor(role);
      return;
    }
    try {
      const { role: accountRole } = await fb.signIn(email.value.trim(), password.value, remember.checked);
      if (!accountRole) { await fb.signOutUser(); throw Object.assign(new Error('no role'), { code: 'permission-denied' }); }
      if (accountRole !== role) {
        await fb.signOutUser();
        busy(false);
        say(`This is a ${accountRole} account. Use the ${accountRole} sign-in.`, true);
        return;
      }
      location.href = dashboardFor(role);
    } catch (err) {
      busy(false);
      say(fb.message(err), true);
    }
  });
}

// ---------------------------------------------------------------- sign-up page
const signupForm = document.querySelector('[data-signup]');
if (signupForm) {
  let role = new URLSearchParams(location.search).get('role') === 'player' ? 'player' : 'coach';
  const email = signupForm.querySelector('#email');
  const password = signupForm.querySelector('#password');
  const confirm = signupForm.querySelector('#confirm');
  const remember = signupForm.querySelector('#remember');
  const { setError, say, busy } = formTools(signupForm);

  const showRole = () => {
    document.querySelectorAll('[data-role-pick]').forEach((a) => {
      if (a.dataset.rolePick === role) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-role-text]').forEach((el) => { el.textContent = role; });
    document.querySelectorAll('[data-signin-link]').forEach((a) => { a.href = loginFor(role); });
  };
  document.querySelectorAll('[data-role-pick]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    role = a.dataset.rolePick;
    history.replaceState(null, '', `?role=${role}`);
    showRole();
  }));
  showRole();
  if (!fb) say('Accounts are being set up. Until then, use the demo sign-in.');

  const checkNew = (input) => {
    const v = input.value;
    if (!v) return 'Choose a password.';
    if (v.length < 8) return 'Use at least 8 characters.';
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Use both letters and numbers.';
    if (v.trim().toLowerCase() === email.value.trim().toLowerCase()) return 'Do not use your email as the password.';
    return '';
  };
  const checkConfirm = (input) => (!input.value ? 'Type the password again.' : input.value !== password.value ? 'The two passwords do not match.' : '');
  const meter = signupForm.querySelector('[data-strength]');
  password.addEventListener('input', () => {
    const v = password.value;
    const score = [v.length >= 8, /[A-Za-z]/.test(v) && /\d/.test(v), v.length >= 12, /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
    meter.dataset.score = String(v ? score : 0);
    meter.querySelector('span').textContent = !v ? '' : ['Too weak', 'Weak', 'Good', 'Strong', 'Very strong'][score];
  });

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signupForm.querySelector('.submit').getAttribute('aria-busy') === 'true') return;
    const problems = validate([[email, checkEmail], [password, checkNew], [confirm, checkConfirm]], setError);
    if (problems.length) { say(problems.length === 1 ? 'Fix 1 field to create your account.' : `Fix ${problems.length} fields to create your account.`, true); problems[0].focus(); return; }
    if (!fb) { say('Accounts are not switched on yet. Use the demo sign-in for now.', true); return; }
    say('Creating your account…');
    busy(true, 'Creating account…');
    try {
      await fb.signUp(email.value.trim(), password.value, role, remember.checked);
      location.href = dashboardFor(role);
    } catch (err) {
      busy(false);
      if (err?.code === 'auth/email-already-in-use') setError(email, 'This email already has an account.');
      say(fb.message(err), true);
    }
  });
}

// ---------------------------------------------------------------- dashboards: only for a signed-in user of the right role
const gate = document.querySelector('[data-dashboard]');
if (gate) {
  const role = gate.dataset.dashboard;
  const open = (emailText, signOut) => {
    gate.querySelectorAll('[data-email]').forEach((el) => { el.textContent = emailText; });
    gate.hidden = false;
    gate.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', async () => { await signOut(); location.href = 'index.html'; }));
  };
  if (fb) {
    const user = await fb.currentUser();
    const accountRole = user ? await fb.roleOf(user).catch(() => null) : null;
    if (!user || !accountRole) location.replace(loginFor(role));
    else if (accountRole !== role) location.replace(dashboardFor(accountRole));
    else open(user.email, fb.signOutUser);
  } else {
    const session = demo.read();
    if (!session || session.role !== role) location.replace(loginFor(role));
    else open(session.email, async () => demo.clear());
  }
}
