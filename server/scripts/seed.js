// Creates demo accounts through the running API (so the live server's in-memory store sees them).
// Usage: npm run seed -w server   (server must be running)
const API = process.env.API_URL || 'http://localhost:4000';
const DEMO_PASSWORD = 'relay-demo-2026';
const DEMO_USERS = [
  { username: 'alice', displayName: 'Alice Johnson' },
  { username: 'bob', displayName: 'Bob Smith' },
  { username: 'carol', displayName: 'Carol Diaz' },
];

for (const u of DEMO_USERS) {
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...u, password: DEMO_PASSWORD }),
  });
  const status = res.status === 201 ? 'created' : res.status === 409 ? 'already exists' : `failed (${res.status})`;
  console.log(`${u.username.padEnd(6)} ${status}`);
}
console.log(`\nDemo password for all accounts: ${DEMO_PASSWORD}`);
