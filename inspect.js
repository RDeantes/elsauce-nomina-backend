const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const fecha = new Date("2026-05-19T00:00:00");
  const asist = await prisma.asistencias.findFirst({ where: { id_empleado: BigInt(1), fecha } });
  const nom = await prisma.nominas.findMany({ where: { id_empleado: BigInt(1), fecha_inicio: fecha } });
  const r = (obj) => JSON.stringify(obj, (k, v) => typeof v === "bigint" ? v.toString() : v, 2);
  console.log("asistencia", r(asist));
  console.log("nominas", r(nom));
  await prisma.$disconnect();
})();
