const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const nuevo = await prisma.empleados.create({
      data: {
        nombre: 'QA_TEST_DIRECT',
        apellido_paterno: 'AUTO',
        apellido_materno: 'PRUEBA',
        telefono: '0000000000',
        curp: 'QATEST0000000000',
        direccion: 'CALLE TEST 123',
        fecha_nacimiento: new Date('1990-01-01'),
        fecha_ingreso: new Date('2026-05-18'),
        departamento_id: BigInt(1),
        puesto_id: BigInt(4),
        tipo_contrato: 'TEMPORAL',
        fecha_vigencia: new Date('2026-06-18'),
        nacionalidad: 'MEXICANA',
        sexo: 'FEMENINO',
        activo: true,
        Pago_hora: 50,
        hora_programada_entrada: '08:00:00',
        Tipo_Pago: 'DIARIO',
        Pago_diario: null
      }
    });
    console.log('CREATED', JSON.stringify(nuevo, null, 2));
  } catch (e) {
    console.error('ERR', e);
  } finally {
    await prisma.$disconnect();
  }
})();
