// Browser-safe entry point: `hive-stream/scaffold`.
//
// Generates the same project `npx hive-stream new` writes, as an in-memory
// map of file paths to contents. Nothing here touches the filesystem, so UIs
// can call it and zip or preview the result. Keep this module graph free of
// Node built-ins (enforced by tests/browser-safe-entries.spec.ts).
export {
    generateProjectFiles,
    getNextSteps,
    validateProjectName
} from './project';
export type { NextStepsOptions, ScaffoldOptions, ScaffoldResult } from './project';
export {
    ADAPTERS,
    TEMPLATES,
    getAdapter,
    getAdapterCompatibilityError,
    getCompatibleAdapters,
    getTemplate
} from './templates';
export type {
    AdapterCapability,
    AdapterDefinition,
    AdapterId,
    TemplateDefinition,
    TemplateId,
    UsageExample
} from './templates';
export { validateHiveAccountName } from '../validation/hive-account';
export { HIVE_STREAM_VERSION } from './version';
