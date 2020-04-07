import fs from 'fs';
import { AdapterBase } from './base.adapter';
import { TimeAction } from '../actions';
import { SignedBlock } from '@hivechain/dhive';

export class FileAdapter extends AdapterBase {
    protected async create(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const data = {
                lastBlockNumber: 0,
                actions: []
            };
    
            if (!fs.existsSync('hive-stream.json')) {
                fs.writeFile('hive-stream.json', JSON.stringify(data), err => {
                    if (err) {
                        console.error(err);
        
                        reject(err);
                    } else {
                        resolve(true);
                    }
                });
            } else {
                resolve(true);
            }
        });
    }

    protected async loadActions(): Promise<TimeAction[]> {
        if (fs.existsSync('hive-stream.json')) {
            const file = JSON.parse((fs.readFileSync('hive-stream.json') as unknown) as string);

            return (file?.actions) ? file.actions : [];
        }
    }

    protected loadState() {
        if (fs.existsSync('hive-stream.json')) {
            const state = JSON.parse((fs.readFileSync('hive-stream.json') as unknown) as string);

            return state;
        }
    }

    protected async saveState(data: any) {
        fs.writeFile('hive-stream.json', JSON.stringify(data), err => {
            if (err) {
                console.error(err);

                return err;
            }

            return true;
        });
    }
}