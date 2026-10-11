import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/server/demo/seed";

const db = new PrismaClient();

seedDatabase(db)
  .then((summary) => {
    console.log("✔ Dados de demonstração (fictícios) carregados:");
    console.table(summary);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
