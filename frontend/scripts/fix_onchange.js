import fs from 'fs';

// Simple script to inject showError(null) and showSuccess(null) into all forms' onChange
const files = [
  'frontend/src/pages/InboundRoutesPage.tsx',
  'frontend/src/pages/ExtensionsPage.tsx',
  'frontend/src/pages/Trunks/TrunksPage.tsx',
  'frontend/src/pages/FlowsPage.tsx',
  'frontend/src/pages/AudioPage.tsx' // Already fixed AudioPage, but let's check
];

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf-8');
  let original = content;

  // We want to catch things like: onChange={(event) => setCreateForm((current) => ({ ...current, did: event.target.value }))}
  // And rewrite it to: onChange={(event) => { resetMessages(); setCreateForm((current) => ({ ...current, did: event.target.value })); }}
  // Or if resetMessages isn't there, showError(null).

  const resetCall = content.includes('resetMessages()') ? 'resetMessages()' : 'showError(null)';

  // Pattern for single-line arrow function in onChange:
  // onChange={(arg) => functionCall(...)}
  content = content.replace(/onChange=\{\((.*?)\) => (set[a-zA-Z0-9_]+\(.*?\))([^;]*?)\}/g, `onChange={($1) => { ${resetCall}; $2$3; }}`);
  // Pattern for single-line arrow function with single arg no parens:
  // onChange={arg => functionCall(...)}
  content = content.replace(/onChange=\{([a-zA-Z0-9_]+) => (set[a-zA-Z0-9_]+\(.*?\))([^;]*?)\}/g, `onChange={($1) => { ${resetCall}; $2$3; }}`);

  // Note: generalist may have missed some.

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log('Fixed inputs in', file);
  }
});
