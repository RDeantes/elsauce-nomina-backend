const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const maxId = await prisma.$queryRaw`SELECT MAX(id_empleado) AS max_id FROM empleados`; 
    console.log('max_id:', maxId);
    const seqName = await prisma.$queryRaw`SELECT pg_get_serial_sequence('empleados', 'id_empleado') AS seq_name`; 
    console.log('seq_name:', seqName);
    const seqInfo = await prisma.$queryRaw`SELECT last_value, is_called FROM empleados_id_empleado_seq`; 
    console.log('seq_info:', seqInfo);
  } catch (e) {
    console.error('ERR', e);
  } finally {
    await prisma.$disconnect();
  }
})();
