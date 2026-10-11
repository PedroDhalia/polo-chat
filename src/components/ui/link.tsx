import NextLink from "next/link";

/**
 * Link sem prefetch automático. Em produção o Next pré-carrega todo link visível na tela;
 * em listas (participantes, conversas, reembolsos, pendências) isso disparava dezenas de
 * renderizações no servidor a cada página aberta. A página carrega no clique (~30 ms em produção).
 * Use este Link em todo o app, inclusive no menu lateral.
 */
export function Link(props: React.ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}

export default Link;
