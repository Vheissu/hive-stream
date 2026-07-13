import readline from 'readline';

export interface Choice<T extends string = string> {
    value: T;
    label: string;
    hint?: string;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

export const color = {
    bold: (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text),
    dim: (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text),
    cyan: (text: string) => (useColor ? `\x1b[36m${text}\x1b[0m` : text),
    green: (text: string) => (useColor ? `\x1b[32m${text}\x1b[0m` : text),
    red: (text: string) => (useColor ? `\x1b[31m${text}\x1b[0m` : text),
    yellow: (text: string) => (useColor ? `\x1b[33m${text}\x1b[0m` : text)
};

export function isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function createInterface(): readline.Interface {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

export async function text(question: string, defaultValue: string, validate?: (value: string) => string | null): Promise<string> {
    if (!isInteractive()) {
        return defaultValue;
    }

    const rl = createInterface();

    try {
        while (true) {
            const suffix = defaultValue ? color.dim(` (${defaultValue})`) : '';
            const answer = await ask(rl, `${color.cyan('?')} ${question}${suffix} `);
            const value = answer || defaultValue;
            const error = validate ? validate(value) : null;

            if (!error) {
                return value;
            }

            console.log(`  ${color.red(error)}`);
        }
    } finally {
        rl.close();
    }
}

export async function select<T extends string>(question: string, choices: Choice<T>[], defaultValue: T): Promise<T> {
    if (!isInteractive()) {
        return defaultValue;
    }

    const rl = createInterface();

    try {
        console.log(`${color.cyan('?')} ${question}`);

        choices.forEach((choice, index) => {
            const marker = choice.value === defaultValue ? color.green('●') : color.dim('○');
            const hint = choice.hint ? ` ${color.dim(`- ${choice.hint}`)}` : '';

            console.log(`  ${marker} ${color.bold(String(index + 1))}. ${choice.label}${hint}`);
        });

        const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue) + 1;

        while (true) {
            const answer = await ask(rl, `  ${color.dim(`Choose 1-${choices.length} (${defaultIndex})`)} `);

            if (!answer) {
                return defaultValue;
            }

            const index = Number(answer);

            if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
                return choices[index - 1].value;
            }

            console.log(`  ${color.red(`Enter a number between 1 and ${choices.length}.`)}`);
        }
    } finally {
        rl.close();
    }
}

export async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
    if (!isInteractive()) {
        return defaultValue;
    }

    const rl = createInterface();

    try {
        const suffix = defaultValue ? 'Y/n' : 'y/N';

        while (true) {
            const answer = (await ask(rl, `${color.cyan('?')} ${question} ${color.dim(`(${suffix})`)} `)).toLowerCase();

            if (!answer) {
                return defaultValue;
            }

            if (['y', 'yes'].includes(answer)) {
                return true;
            }

            if (['n', 'no'].includes(answer)) {
                return false;
            }

            console.log(`  ${color.red('Enter y or n.')}`);
        }
    } finally {
        rl.close();
    }
}
