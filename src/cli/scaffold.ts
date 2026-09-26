import fs from 'fs';
import path from 'path';

// Project generation is pure and lives in src/scaffold (published as the
// browser-safe `hive-stream/scaffold` entry). This module adds the
// filesystem side the CLI needs.
export {
    generateProjectFiles,
    getNextSteps,
    validateHiveAccountName,
    validateProjectName
} from '../scaffold';
export type { NextStepsOptions, ScaffoldOptions, ScaffoldResult } from '../scaffold';

export function writeProjectFiles(targetDir: string, files: Record<string, string>): string[] {
    const written: string[] = [];

    for (const [relativePath, contents] of Object.entries(files)) {
        const fullPath = path.join(targetDir, relativePath);

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, contents, 'utf8');
        written.push(relativePath);
    }

    return written;
}

export function isDirectoryUsable(targetDir: string): { usable: boolean; reason?: string } {
    if (!fs.existsSync(targetDir)) {
        return { usable: true };
    }

    const stats = fs.statSync(targetDir);

    if (!stats.isDirectory()) {
        return { usable: false, reason: 'A file with that name already exists.' };
    }

    const entries = fs.readdirSync(targetDir).filter((entry) => entry !== '.git');

    if (entries.length > 0) {
        return { usable: false, reason: 'Directory already exists and is not empty.' };
    }

    return { usable: true };
}
