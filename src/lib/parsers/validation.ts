export class ImportValidationError extends Error {
  constructor(public readonly details: string[]) {
    super(`لم تُحفظ الدفعة بسبب أخطاء في الملف (${details.length}): ${details.slice(0, 5).join('؛ ')}`)
    this.name = 'ImportValidationError'
  }
}

export function assertValidImports(results: Array<{ label: string; errors: string[] }>) {
  const errors = results.flatMap(result => result.errors.map(error => `${result.label}: ${error}`))
  if (errors.length) throw new ImportValidationError(errors)
}
