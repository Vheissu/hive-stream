const HIVE_ACCOUNT_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export function validateHiveAccountName(name: string): string | null {
    if (!name) {
        return 'Hive account name is required.';
    }

    if (name.length < 3 || name.length > 16) {
        return 'Hive account name must be between 3 and 16 characters.';
    }

    const segments = name.split('.');

    if (segments.some((segment) => segment.length < 3 || !HIVE_ACCOUNT_SEGMENT_PATTERN.test(segment))) {
        return 'Hive account segments must start with a letter, end with a letter or number, and use lowercase letters, numbers, or hyphens.';
    }

    return null;
}

export function normalizeHiveAccountName(value: unknown, label = 'Hive account name'): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string.`);
    }

    const name = value.trim().replace(/^@/, '');
    const error = validateHiveAccountName(name);

    if (error) {
        throw new Error(`${label} is invalid. ${error}`);
    }

    return name;
}
