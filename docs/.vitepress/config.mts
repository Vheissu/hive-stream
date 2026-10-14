import { defineConfig } from 'vitepress';
import contractSidebar from '../contracts/sidebar.json';

export default defineConfig({
    title: 'Hive Stream',
    description: 'The Node.js library for building apps on the Hive blockchain: streaming, contracts, payments, and testing.',
    base: '/hive-stream/',
    lastUpdated: true,

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/guide/getting-started' },
            { text: 'Recipes', link: '/guide/recipes' },
            { text: 'Contracts', link: '/contracts/' },
            { text: 'CLI', link: '/guide/cli' },
            { text: 'npm', link: 'https://www.npmjs.com/package/hive-stream' }
        ],

        sidebar: {
            '/guide/': [
                {
                    text: 'Introduction',
                    items: [
                        { text: 'Getting Started', link: '/guide/getting-started' },
                        { text: 'Hive Basics', link: '/guide/hive-basics' },
                        { text: 'Recipes', link: '/guide/recipes' },
                        { text: 'Scaffolding with the CLI', link: '/guide/cli' },
                        { text: 'Configuration', link: '/guide/configuration' },
                        { text: 'Migrating to 5.0', link: '/guide/migrating-to-5' },
                        { text: 'Migrating to 4.0', link: '/guide/migrating-to-4' }
                    ]
                },
                {
                    text: 'Core Concepts',
                    items: [
                        { text: 'Streaming & Subscriptions', link: '/guide/streaming' },
                        { text: 'Writing Contracts', link: '/guide/contracts' },
                        { text: 'Hooks & Guards', link: '/guide/hooks' },
                        { text: 'Provably Fair Randomness', link: '/guide/fairness' },
                        { text: 'Calling Contracts Safely', link: '/guide/contract-calls' },
                        { text: 'Time-Based Actions', link: '/guide/time-actions' },
                        { text: 'Storage Adapters', link: '/guide/adapters' }
                    ]
                },
                {
                    text: 'Payments & Operations',
                    items: [
                        { text: 'Transfer Flows', link: '/guide/flows' },
                        { text: 'Escrow', link: '/guide/escrow' },
                        { text: 'Broadcasting Operations', link: '/guide/operations' },
                        { text: 'Querying the Chain', link: '/guide/queries' }
                    ]
                },
                {
                    text: 'Quality & Production',
                    items: [
                        { text: 'Testing Your App', link: '/guide/testing' },
                        { text: 'Running in Production', link: '/guide/production' },
                        { text: 'Security', link: '/guide/security' },
                        { text: 'Troubleshooting', link: '/guide/troubleshooting' }
                    ]
                },
                {
                    text: 'Tooling',
                    items: [
                        { text: 'Building UIs and Tools', link: '/guide/ui-integration' }
                    ]
                }
            ],
            '/contracts/': [
                {
                    text: 'Built-in Contracts',
                    items: [
                        { text: 'Overview', link: '/contracts/' },
                        ...contractSidebar
                    ]
                }
            ]
        },

        socialLinks: [
            { icon: 'github', link: 'https://github.com/Vheissu/hive-stream' }
        ],

        search: {
            provider: 'local'
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © Dwayne Charrington'
        }
    }
});
