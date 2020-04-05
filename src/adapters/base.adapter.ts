export class AdapterBase {
    protected loadState() {
        throw new Error('Load state method not implemented in adapter');
    }

    protected async saveState(data: any) {
        throw new Error('Save state method not implemented in adapter');
    }
}