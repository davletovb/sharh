export class SeatlinePreferences {
  constructor(storage) {
    this.storage = storage;
    this.value = {allowGeminiCloud: false};
    this.version = 0;
    this.loading = null;
    storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.seatlinePolicy) return;
      this.version++;
      this.loading = null;
      this.value = {allowGeminiCloud: changes.seatlinePolicy.newValue?.allowGeminiCloud === true};
    });
  }
  refresh() {
    const version = ++this.version;
    const loading = this.storage.local
      .get('seatlinePolicy')
      .then((saved) => {
        if (version === this.version)
          this.value = {allowGeminiCloud: saved.seatlinePolicy?.allowGeminiCloud === true};
        // An older read must not overwrite, or return ahead of, a newer read or a storage event.
        else if (this.loading && this.loading !== loading) return this.loading;
        return this.value;
      })
      .finally(() => {
        if (this.loading === loading) this.loading = null;
      });
    this.loading = loading;
    return loading;
  }
}
