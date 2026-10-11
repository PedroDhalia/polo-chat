/** Erro de regra de negócio — a mensagem é exibida ao usuário. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
