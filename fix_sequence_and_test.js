const { PrismaClient } = require('@prisma/client');
const fetch = global.fetch;
const prisma = new PrismaClient();

(async () => {
  try {
    console.log('1) Ajustando la secuencia empleados_id_empleado_seq...');
    const result = await prisma.$executeRaw`
      SELECT setval('public.empleados_id_empleado_seq', (SELECT MAX(id_empleado) FROM empleados));
    `;
    console.log('Secuencia ajustada:', result);

    console.log('2) Probando POST /empleados');
    const payload = {
      nombre: 'QA_TEST',
      apellido_paterno: 'AUTO',
      apellido_materno: 'PRUEBA',
      telefono: '0000000000',
      curp: 'QATEST0000000000',
      direccion: 'CALLE TEST 123',
      fecha_nacimiento: '1990-01-01',
      fecha_ingreso: '2026-05-18',
      departamento_id: 1,
      puesto_id: 4,
      tipo_contrato: 'TEMPORAL',
      fecha_vigencia: '2026-06-18',
      nacionalidad: 'MEXICANA',
      sexo: 'FEMENINO',
      Pago_hora: 50,
      hora_programada_entrada: '08:00:00',
      Tipo_Pago: 'DIARIO',
      Pago_diario: null
    };

    const response = await fetch('http://localhost:3000/empleados', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('status:', response.status);
    const body = await response.text();
    console.log('response:', body);
  } catch (error) {
    console.error('ERROR', error);
  } finally {
    await prisma.$disconnect();
  }
})();
