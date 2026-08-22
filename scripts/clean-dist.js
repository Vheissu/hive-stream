const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');

if (path.dirname(distPath) !== projectRoot || path.basename(distPath) !== 'dist') {
    throw new Error(`Refusing to clean unexpected path: ${distPath}`);
}

fs.rmSync(distPath, { recursive: true, force: true });
