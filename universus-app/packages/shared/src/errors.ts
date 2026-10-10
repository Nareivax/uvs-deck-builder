/** A bad filter or query parameter. The API turns this into an HTTP 400. */
export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterError';
  }
}
