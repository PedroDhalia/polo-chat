// Datas de teste no fuso do centro (America/Sao_Paulo, UTC-3): o resultado não depende do fuso da máquina.

/** brt("2026-10-14", "10:00") = quarta-feira, 14/10/2026, 10:00 em Brasília. */
export const brt = (date: string, time = "00:00") => new Date(`${date}T${time}:00-03:00`);

/** Referência dos testes: quarta-feira, 14/10/2026, 10:00. */
export const WED_10H = brt("2026-10-14", "10:00");
