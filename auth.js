// Sign-in prototype. There is no server on GitHub Pages, so this checks the form in the browser and keeps a demo
// session in the browser's storage. Swap `signIn` for a real service (Firebase, Supabase) when accounts exist.

const KEY = 'clutchmetrics-session';

const store = {
  read() {
    for (const area of [sessionStorage, localStorage]) {
      try { const raw = area.getItem(KEY); if (raw) return JSON.parse(raw); } catch { /* storage blocked */ }
    }
    return null;
  },
  write(session, remember) {
    try { (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session)); return true; } catch { return false; }
  },
  clear() {
    for (const area of [sessionStorage, localStorage]) { try { area.removeItem(KEY); } catch { /* storage blocked */ } }
  },
};

// stands in for a real sign-in request
const signIn = ({ role, email }) => new Promise((resolve) => {
  setTimeout(() => resolve({ role, email, at: Date.now() }), 700);
});

const form = document.querySelector('[data-signin]');
if (form) {
  const role = form.dataset.signin;
  const email = form.querySelector('#email');
  const password = form.querySelector('#password');
  const remember = form.querySelector('#remember');
  const submit = form.querySelector('.submit');
  const label = submit.querySelector('.submit__label');
  const status = form.querySelector('[data-status]');
  const idle = label.textContent;

  // already signed in with this role: go straight through
  const existing = store.read();
  if (existing && existing.role === role) location.replace(`${role}-dashboard.html`);

  const setError = (input, message) => {
    const out = document.getElementById(`${input.id}-error`);
    out.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  const check = (input) => {
    const value = input.value.trim();
    if (input === email) {
      if (!value) return 'Enter your email address.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter an email address with an @ and a domain, like name@team.com.';
    }
    if (input === password) {
      if (!input.value) return 'Enter your password.';
      if (input.value.length < 6) return 'Use at least 6 characters.';
    }
    return '';
  };

  // errors appear after a field is left, and clear as soon as it is fixed
  [email, password].forEach((input) => {
    input.addEventListener('blur', () => { if (input.value) setError(input, check(input)); });
    input.addEventListener('input', () => { if (input.getAttribute('aria-invalid')) setError(input, check(input)); });
  });

  // show or hide the password
  const reveal = form.querySelector('.reveal');
  reveal.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    reveal.textContent = show ? 'Hide' : 'Show';
    reveal.setAttribute('aria-pressed', String(show));
    reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  // no accounts yet, so the reset link explains instead of failing silently
  form.querySelector('[data-forgot]').addEventListener('click', () => {
    status.classList.remove('is-error');
    status.textContent = 'Password reset opens when real accounts launch. For the demo, use any email and a password of 6 or more characters.';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    const problems = [email, password].map((input) => {
      const message = check(input);
      setError(input, message);
      return message ? input : null;
    }).filter(Boolean);
    if (problems.length) {
      status.classList.add('is-error');
      status.textContent = problems.length === 1 ? 'Fix 1 field to sign in.' : `Fix ${problems.length} fields to sign in.`;
      problems[0].focus();
      return;
    }
    status.classList.remove('is-error');
    status.textContent = 'Signing in…';
    submit.setAttribute('aria-busy', 'true');
    label.textContent = 'Signing in…';
    const session = await signIn({ role, email: email.value.trim() });
    if (!store.write(session, remember.checked)) {
      submit.removeAttribute('aria-busy');
      label.textContent = idle;
      status.classList.add('is-error');
      status.textContent = 'Your browser is blocking site storage, so the demo cannot keep you signed in. Allow site data and try again.';
      return;
    }
    location.href = `${role}-dashboard.html`;
  });
}

// the dashboard pages: only for a signed-in user of the right role
const gate = document.querySelector('[data-dashboard]');
if (gate) {
  const role = gate.dataset.dashboard;
  const session = store.read();
  if (!session || session.role !== role) {
    location.replace(`login-${role}.html`);
  } else {
    gate.querySelectorAll('[data-email]').forEach((el) => { el.textContent = session.email; });
    gate.hidden = false;
    gate.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', () => {
      store.clear();
      location.href = 'index.html';
    }));
  }
}
