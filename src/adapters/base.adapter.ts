export class AdapterBase {
    protected load() {
        throw new Error('Load method not implemented in adapter');
    }

    protected async save(data: any) {
        throw new Error('Save method not implemented in adapter');
    }
}