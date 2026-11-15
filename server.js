const QRCode = require("qrcode");
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const cron = require("node-cron");
const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = require("docx");
const fs = require("fs");

const prisma = new PrismaClient();
const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000', 
    'https://elsauce-nomina-frontend-production.up.railway.app',
    'https://elsauce-nomina-frontend-production.up.railway.app/'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ============================================================
// 0. AUTENTICACIÓN Y PERMISOS
// ============================================================
// - Login con usuario/contraseña (tabla "usuarios") -> token JWT de 12 horas.
// - AUTH_ENFORCED=true (variable de Railway) activa la protección de rutas.
//   Mientras no esté en "true" todo funciona como antes (para desplegar sin romper nada).
// - El webhook del lector (/asistencias/webhook) siempre es público: ya tiene su propio secret.

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const AUTH_ENFORCED = process.env.AUTH_ENFORCED === "true";
// ADMIN: acceso total (incluye Usuarios). GERENTE: encargada y dueña, todas las pestañas menos Usuarios.
// La sesión dura 30 días y se renueva sola cada vez que se abre el sistema (/auth/me),
// así que quien lo usa seguido no tiene que volver a iniciar sesión.
const DIAS_SESION = Number(process.env.SESSION_DAYS) || 30;
const ROLES_VALIDOS = ["ADMIN", "GERENTE", "CAJERA", "MESERAS"];

const RUTAS_PUBLICAS = new Set([
    "GET /",
    "POST /auth/login",
    "POST /asistencias/webhook",
]);

// ADMIN puede todo. Las demás rutas, por defecto, están prohibidas para los otros roles.
function rutaPermitida(rol, metodo, ruta) {
    if (rol === "ADMIN") return true;
    if (ruta === "/auth/me") return true;

    // Encargada y dueña: todo, excepto la administración de usuarios
    if (rol === "GERENTE") return !ruta.startsWith("/usuarios");

    // Lista de empleados (solo lectura; para no-ADMIN se devuelven pocos campos)
    if (metodo === "GET" && ruta === "/empleados") return rol === "CAJERA" || rol === "MESERAS";

    if (rol === "CAJERA") {
        // Pestañas: Asistencias, Nómina (incluye Historial)
        return ruta.startsWith("/asistencias") || ruta.startsWith("/nominas");
    }
    if (rol === "MESERAS") {
        // Pestaña: Descansos
        return ruta.startsWith("/descansos");
    }
    return false;
}

// Cache corto del usuario para respetar cambios de rol / desactivaciones sin pegarle a la BD en cada llamada.
const cacheUsuarios = new Map();
async function usuarioVigente(id) {
    const hit = cacheUsuarios.get(id);
    if (hit && Date.now() - hit.ts < 30000) return hit.u;
    const u = await prisma.usuarios.findUnique({ where: { id_usuario: BigInt(id) } });
    const dato = u && u.activo ? { id: Number(u.id_usuario), username: u.username, rol: u.rol } : null;
    cacheUsuarios.set(id, { ts: Date.now(), u: dato });
    return dato;
}

app.use(async (req, res, next) => {
    try {
        if (req.method === "OPTIONS") return next();
        if (RUTAS_PUBLICAS.has(`${req.method} ${req.path}`)) return next();

        const h = req.headers.authorization || "";
        const token = h.startsWith("Bearer ") ? h.slice(7) : null;
        if (token && JWT_SECRET) {
            try {
                const dec = jwt.verify(token, JWT_SECRET);
                req.usuario = await usuarioVigente(dec.id);
            } catch (e) {
                req.usuario = null;
            }
        }

        if (!AUTH_ENFORCED) return next();
        if (!req.usuario) return res.status(401).json({ error: "No autenticado" });
        if (!rutaPermitida(req.usuario.rol, req.method, req.path)) {
            return res.status(403).json({ error: "No tienes permiso para esto" });
        }
        next();
    } catch (error) {
        console.error("Error en autenticación:", error);
        res.status(500).json({ error: "Error de autenticación" });
    }
});

app.get("/", (req, res) => {
    res.json({ mensaje: "Backend funcionando 🚀" });
});

// ============================================================
// 1. FUNCIONES DE AYUDA (HELPERS)
// ============================================================

function convertirBigInt(data) {
    return JSON.parse(
        JSON.stringify(
            data,
            (key, value) => {
                if (typeof value === "bigint") return value.toString();
                if (key === "fecha" && value) return value.split('T')[0];
                return value;
            }
        )
    );
}

function convertirHoraAMinutos(hora) {
    if (!hora) return 0;
    const [h, m] = hora.split(":");
    return (parseInt(h) * 60) + parseInt(m);
}

// Tolerancia en minutos: la de cada empleado ("tolerancia_base", 10 por defecto;
// puede ser 0). Los domingos se le suman los minutos extra que tenga en
// "tolerancia_extra_domingo" (0 si no tiene).
function toleranciaParaFecha(empleado, fecha) {
    const BASE = Number(empleado?.tolerancia_base ?? 10);
    const esDomingo = fecha.getDay() === 0;
    const extra = esDomingo ? Number(empleado?.tolerancia_extra_domingo || 0) : 0;
    return BASE + extra;
}

// Con retardo dentro de la tolerancia no hay descuento. Fuera de ella se
// descuenta igual que siempre, por bloques de 10 min: 1-10 = $10, 11-20 = $20,
// 21-30 = $30, etc. (con tolerancia 10 el primer bloque queda sin descuento).
function calcularDescuento(minutosRetardo, tolerancia = 10) {
    if (minutosRetardo <= tolerancia) return 0;
    const bloque = Math.ceil((minutosRetardo - 10) / 10);
    return bloque * 10 + 10;
}

app.get("/empleados/:id/qr", async (req, res) => {
  try {
    const { id } = req.params;
    const contenido = `id_empleado=${id}`;
    const qr = await QRCode.toDataURL(contenido);
    res.json({ ok: true, qr });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, mensaje: "Error generando QR" });
  }
});

// ============================================================
// 2. TAREAS AUTOMÁTICAS (CRON JOBS)
// ============================================================

cron.schedule('0 1 * * *', async () => {
    console.log("⏳ Ejecutando pre-carga de asistencias (FALTAS y DESCANSOS)...");
    try {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0); 
        
        let diaSemanaActual = hoy.getDay(); 
        if (diaSemanaActual === 0) diaSemanaActual = 7;

        const empleados = await prisma.empleados.findMany({
            where: { activo: true },
            include: { descansos_empleados: true }
        });

        const asistenciasPorCrear = empleados.map(emp => {
            const descansaHoy = emp.descansos_empleados.some(d => d.dia_semana === diaSemanaActual);
            return {
                id_empleado: emp.id_empleado,
                fecha: hoy,
                estatus: descansaHoy ? "DESCANSO" : "FALTA",
                minutos_retardo: 0,
                descuento_retardo: 0
            };
        });

        if (asistenciasPorCrear.length > 0) {
            await prisma.asistencias.createMany({
                data: asistenciasPorCrear,
                skipDuplicates: true
            });
            console.log(`✅ Pre-carga finalizada: ${asistenciasPorCrear.length} registros.`);
        }
    } catch (error) {
        console.error("❌ Error en Cron Job:", error);
    }
});

// ============================================================
// 3. RUTAS DE EMPLEADOS
// ============================================================

app.get("/empleados", async (req, res) => {
    try {
        const empleados = await prisma.empleados.findMany();
        if (req.usuario && req.usuario.rol !== "ADMIN" && req.usuario.rol !== "GERENTE") {
            // Sin datos personales: solo lo necesario para listar nombres
            const basicos = empleados.map(e => ({
                id_empleado: e.id_empleado,
                nombre: e.nombre,
                apellido_paterno: e.apellido_paterno,
                apellido_materno: e.apellido_materno,
                activo: e.activo,
                departamento_id: e.departamento_id,
                puesto_id: e.puesto_id,
            }));
            return res.json(convertirBigInt(basicos));
        }
        res.json(convertirBigInt(empleados));
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo empleados" });
    }
});

app.post("/empleados", async (req, res) => {
    try {
        const nuevoEmpleado = await prisma.empleados.create({
            data: {
                nombre: req.body.nombre,
                apellido_paterno: req.body.apellido_paterno,
                apellido_materno: req.body.apellido_materno,
                telefono: req.body.telefono || null,
                curp: req.body.curp || null,
                direccion: req.body.direccion || null,
                contacto_emerencia: req.body.contacto_emerencia || null,
                nacionalidad: req.body.nacionalidad || null,
                sexo: req.body.sexo || null,
                fecha_nacimiento: req.body.fecha_nacimiento ? new Date(req.body.fecha_nacimiento) : null,
                fecha_ingreso: req.body.fecha_ingreso ? new Date(req.body.fecha_ingreso) : null,
                fecha_vigencia: req.body.fecha_vigencia ? new Date(req.body.fecha_vigencia) : null,
                departamento_id: req.body.departamento_id ? BigInt(req.body.departamento_id) : null,
                puesto_id: req.body.puesto_id ? BigInt(req.body.puesto_id) : null,
                tipo_contrato: req.body.tipo_contrato || null,
                activo: req.body.activo === "true" ? true : false,
                Tipo_Pago: req.body.Tipo_Pago || null,
                Pago_hora: req.body.Pago_hora ? parseFloat(req.body.Pago_hora) : null,
                Pago_diario: req.body.Pago_diario ? parseFloat(req.body.Pago_diario) : null,
                hora_programada_entrada: req.body.hora_programada_entrada || null,
            }
        });
        res.json(convertirBigInt(nuevoEmpleado));
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Error creando empleado", detalle: error.message });
    }
});

app.put("/empleados/:id", async (req, res) => {
    try {
        const empleadoActualizado = await prisma.empleados.update({
            where: { id_empleado: BigInt(req.params.id) },
            data: {
                ...req.body,
                fecha_nacimiento: req.body.fecha_nacimiento ? new Date(req.body.fecha_nacimiento) : null,
                fecha_ingreso: req.body.fecha_ingreso ? new Date(req.body.fecha_ingreso) : null,
                fecha_vigencia: req.body.fecha_vigencia ? new Date(req.body.fecha_vigencia) : null,
                departamento_id: req.body.departamento_id ? BigInt(req.body.departamento_id) : null,
                puesto_id: req.body.puesto_id ? BigInt(req.body.puesto_id) : null,
                Pago_hora: req.body.Pago_hora ? parseFloat(req.body.Pago_hora) : null,
                Pago_diario: req.body.Pago_diario ? parseFloat(req.body.Pago_diario) : null,
                activo: Boolean(req.body.activo),
            },
        });
        res.json(convertirBigInt(empleadoActualizado));
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Error actualizando empleado" });
    }
});

// ============================================================
// 4. RUTAS DE ASISTENCIA Y JUSTIFICACIONES
// ============================================================

app.get("/asistencias", async (req, res) => {
    try {
        // ?fecha=YYYY-MM-DD (un día)  o  ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (rango)
        const { fecha, desde, hasta } = req.query;
        let where = undefined;
        if (fecha) {
            where = { fecha: { gte: new Date(fecha + "T00:00:00"), lte: new Date(fecha + "T23:59:59") } };
        } else if (desde || hasta) {
            where = { fecha: {} };
            if (desde) where.fecha.gte = new Date(desde + "T00:00:00");
            if (hasta) where.fecha.lte = new Date(hasta + "T23:59:59");
        }
        const asistencias = await prisma.asistencias.findMany({
            where,
            include: { empleados: true },
            orderBy: [{ fecha: "asc" }, { hora_entrada: "asc" }],
        });
        res.json(convertirBigInt(asistencias));
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Error obteniendo asistencias" });
    }
});

// ── WEBHOOK DEL LECTOR DAHUA ─────────────────────────────────
app.post("/asistencias/webhook", async (req, res) => {
    try {
        const { id_empleado, fecha, hora, secret } = req.body;

        // 1. Validar secret
        if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
            return res.status(401).json({ error: "No autorizado" });
        }

        // 2. Validar campos mínimos
        if (!id_empleado || !fecha || !hora) {
            return res.status(400).json({ error: "Faltan campos: id_empleado, fecha, hora" });
        }

        const fechaBusqueda = new Date(fecha + "T00:00:00");

        // 3. Verificar que el empleado existe y está activo
        const empleado = await prisma.empleados.findUnique({
            where: { id_empleado: BigInt(id_empleado) }
        });
        if (!empleado || !empleado.activo) {
            return res.status(404).json({ error: "Empleado no encontrado o inactivo" });
        }

        // 4. Escudo anti-duplicados: ignorar si ya existe exactamente esta hora
        const marcaExistente = await prisma.asistencias.findFirst({
            where: {
                id_empleado: BigInt(id_empleado),
                fecha: fechaBusqueda,
                OR: [{ hora_entrada: hora }, { hora_salida: hora }]
            }
        });
        if (marcaExistente) {
            console.log(`⏭️  Duplicado exacto ignorado: empleado ${id_empleado} hora ${hora}`);
            return res.status(200).json({ ok: true, accion: "IGNORADA", mensaje: "Marca duplicada" });
        }

        // 5. Candado de 5 minutos: ignorar si la última marcada fue hace menos de 5 min
        const ultimaMarca = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda },
            orderBy: { id_asistencia: "desc" }
        });
        if (ultimaMarca) {
            const horaReferencia = ultimaMarca.hora_salida || ultimaMarca.hora_entrada;
            const diffMin = Math.abs(convertirHoraAMinutos(hora) - convertirHoraAMinutos(horaReferencia));
            if (diffMin < 5) {
                console.log(`⏱️  Candado 5 min: empleado ${id_empleado}, diff ${diffMin} min, ignorando.`);
                return res.status(200).json({ ok: true, accion: "IGNORADA", mensaje: "Menos de 5 min desde última marca" });
            }
        }

        // 6. ¿Tiene una entrada abierta (sin salida)?
        const asistenciaAbierta = await prisma.asistencias.findFirst({
            where: {
                id_empleado: BigInt(id_empleado),
                fecha: fechaBusqueda,
                hora_entrada: { not: null },
                hora_salida: null
            }
        });

        if (asistenciaAbierta) {
            // ── REGISTRAR SALIDA ──────────────────────────────
            console.log(`🚪 Salida: empleado ${id_empleado} a las ${hora}`);

            const entradaMin     = convertirHoraAMinutos(asistenciaAbierta.hora_entrada);
            const salidaMin      = convertirHoraAMinutos(hora);
            let   horasCalculadas = Math.max(0, salidaMin - entradaMin) / 60;

            // Tope repartidores (puesto_id = 10)
            if (empleado.puesto_id === BigInt(10)) {
                const TOPE = 11 + 40 / 60;
                if (horasCalculadas > TOPE) {
                    horasCalculadas = TOPE;
                    console.log("⚠️ Tope de repartidor aplicado");
                }
            }

            const horasTrabajadas = Number(horasCalculadas.toFixed(2));

            await prisma.asistencias.update({
                where: { id_asistencia: asistenciaAbierta.id_asistencia },
                data: { hora_salida: hora, horas_trabajadas: horasTrabajadas }
            });

            // Acumular en nómina
            try {
                const bruto = empleado.Tipo_Pago?.toUpperCase() === "DIARIO"
                    ? horasTrabajadas * Number(empleado.Pago_hora || 0)
                    : Number(empleado.Pago_diario || 0);
                const descuento = Number(asistenciaAbierta.descuento_retardo || 0);
                const neto      = bruto - descuento;

                const nomina = await prisma.nominas.findFirst({
                    where: { id_empleado: BigInt(id_empleado), fecha_inicio: fechaBusqueda, estatus: "PENDIENTE" }
                });

                if (nomina) {
                    await prisma.nominas.update({
                        where: { id_nomina: nomina.id_nomina },
                        data: {
                            horas_totales:              Number(nomina.horas_totales || 0) + horasTrabajadas,
                            sueldo_bruto:               Number(nomina.sueldo_bruto  || 0) + bruto,
                            total_descuentos_retardo:   Number(nomina.total_descuentos_retardo || 0) + descuento,
                            total_neto:                 Number(nomina.total_neto    || 0) + neto,
                            fecha_fin:                  fechaBusqueda,
                        }
                    });
                } else {
                    await prisma.nominas.create({
                        data: {
                            id_empleado:              BigInt(id_empleado),
                            fecha_inicio:             fechaBusqueda,
                            fecha_fin:                fechaBusqueda,
                            dias_trabajados:          1,
                            horas_totales:            horasTrabajadas,
                            sueldo_bruto:             bruto,
                            total_descuentos_retardo: descuento,
                            total_neto:               neto,
                            estatus:                  "PENDIENTE",
                        }
                    });
                }
            } catch (e) {
                console.error("⚠️ Error acumulando nómina:", e.message);
            }

            return res.status(200).json({ ok: true, accion: "SALIDA", horas: horasTrabajadas });

        } else {
            // ── REGISTRAR ENTRADA (primera vez o regreso) ─────
            console.log(`🟢 Entrada: empleado ${id_empleado} a las ${hora}`);

            // Calcular retardo solo en la primera entrada del día
            const hayEntradasPrevias = await prisma.asistencias.findFirst({
                where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_entrada: { not: null } }
            });

            let minRetardo  = 0;
            let descRetardo = 0;

            if (!hayEntradasPrevias) {
                // Primera entrada: calcular retardo
                const entradaReal = convertirHoraAMinutos(hora);
                const entradaProg = convertirHoraAMinutos(empleado.hora_programada_entrada || "00:00");
                minRetardo  = Math.max(0, entradaReal - entradaProg);
                descRetardo = calcularDescuento(minRetardo, toleranciaParaFecha(empleado, fechaBusqueda));
            }

            // Actualizar registro precargado (FALTA/DESCANSO) si existe y es la primera entrada
            if (!hayEntradasPrevias) {
                const precargada = await prisma.asistencias.findFirst({
                    where: {
                        id_empleado: BigInt(id_empleado),
                        fecha: fechaBusqueda,
                        estatus: { in: ["FALTA", "DESCANSO", "JUSTIFICADA"] }
                    }
                });

                if (precargada) {
                    await prisma.asistencias.update({
                        where: { id_asistencia: precargada.id_asistencia },
                        data: {
                            hora_entrada:      hora,
                            minutos_retardo:   minRetardo,
                            descuento_retardo: descRetardo,
                            estatus:           "PRESENTE",
                        }
                    });
                    return res.status(200).json({ ok: true, accion: "ENTRADA", retardo_min: minRetardo, descuento: descRetardo });
                }
            }

            // Crear nuevo registro (primera entrada sin precarga, o regreso)
            await prisma.asistencias.create({
                data: {
                    id_empleado:       BigInt(id_empleado),
                    fecha:             fechaBusqueda,
                    hora_entrada:      hora,
                    minutos_retardo:   minRetardo,
                    descuento_retardo: descRetardo,
                    estatus:           "PRESENTE",
                }
            });

            return res.status(200).json({ ok: true, accion: "ENTRADA", retardo_min: minRetardo, descuento: descRetardo });
        }

    } catch (error) {
        console.error("❌ Error en webhook Dahua:", error);
        res.status(500).json({ error: "Error interno", detalle: error.message });
    }
});

// ── ENTRADA MANUAL (desde el frontend) ───────────────────────
app.post("/asistencias", async (req, res) => {
    try {
        const { id_empleado, fecha, hora_entrada } = req.body;
        const empleado = await prisma.empleados.findUnique({ where: { id_empleado: BigInt(id_empleado) } });

        if (!empleado || !empleado.hora_programada_entrada) {
            return res.status(400).json({ error: "Empleado no encontrado o sin horario asignado" });
        }

        const fechaBusqueda = new Date(fecha.split('T')[0] + "T00:00:00");

        const ultimaMarca = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_entrada: { not: null } },
            orderBy: { id_asistencia: "desc" }
        });

        if (ultimaMarca) {
            const diffMin = Math.abs(convertirHoraAMinutos(hora_entrada) - convertirHoraAMinutos(ultimaMarca.hora_entrada));
            if (diffMin < 1) {
                return res.status(200).json({ mensaje: "Marcación ignorada: repetida en menos de 1 minuto." });
            }
        }

        const entradaReal = convertirHoraAMinutos(hora_entrada);
        const entradaProg = convertirHoraAMinutos(empleado.hora_programada_entrada);
        let minutosRetardo   = Math.max(0, entradaReal - entradaProg);
        let descuentoRetardo = calcularDescuento(minutosRetardo, toleranciaParaFecha(empleado, fechaBusqueda));

        const asistenciaAbierta = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_salida: null, hora_entrada: { not: null } }
        });

        if (asistenciaAbierta) {
            return res.status(400).json({ error: "Ya existe un periodo de asistencia abierto para este día. Marca salida antes de registrar una nueva entrada." });
        }

        const asistenciaPrevias = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_entrada: { not: null } }
        });

        if (asistenciaPrevias) {
            minutosRetardo   = 0;
            descuentoRetardo = 0;
        }

        const asistenciaPrecargada = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, estatus: { in: ["FALTA", "DESCANSO", "JUSTIFICADA"] } }
        });

        let asistenciaActualizada;

        if (asistenciaPrecargada) {
            asistenciaActualizada = await prisma.asistencias.update({
                where: { id_asistencia: asistenciaPrecargada.id_asistencia },
                data: { hora_entrada, minutos_retardo: minutosRetardo, descuento_retardo: descuentoRetardo, estatus: "PRESENTE" }
            });
        } else {
            asistenciaActualizada = await prisma.asistencias.create({
                data: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_entrada, minutos_retardo: minutosRetardo, descuento_retardo: descuentoRetardo, estatus: "PRESENTE" }
            });
        }

        res.json(convertirBigInt(asistenciaActualizada));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error en registro de entrada" });
    }
});

app.put("/asistencias/salida", async (req, res) => {
    try {
        const { id_empleado, fecha, hora_salida } = req.body;
        const fechaBusqueda = new Date(fecha.split('T')[0] + "T00:00:00");
        
        const asistencia = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, hora_salida: null },
            orderBy: { id_asistencia: "desc" },
            include: { empleados: true }
        });

        if (!asistencia) {
            return res.status(400).json({ error: "Asistencia no encontrada o salida ya marcada" });
        }

        const entradaMin = convertirHoraAMinutos(asistencia.hora_entrada);
        const salidaMin  = convertirHoraAMinutos(hora_salida);
        let horasCalculadas = Math.max(0, salidaMin - entradaMin) / 60;

        if (asistencia.empleados.puesto_id === BigInt(10)) {
            const TOPE_REPARTIDOR = 11 + (40 / 60);
            if (horasCalculadas > TOPE_REPARTIDOR) {
                horasCalculadas = TOPE_REPARTIDOR;
                console.log("⚠️ Tope de repartidor aplicado");
            }
        }

        const horasTrabajadas = Number(horasCalculadas.toFixed(2));

        await prisma.asistencias.update({
            where: { id_asistencia: asistencia.id_asistencia },
            data: { hora_salida, horas_trabajadas: horasTrabajadas }
        });

        const emp   = asistencia.empleados;
        let   bruto = emp.Tipo_Pago?.toUpperCase() === "DIARIO"
                    ? horasTrabajadas * (emp.Pago_hora || 0)
                    : (emp.Pago_diario || 0);
        const neto  = bruto - Number(asistencia.descuento_retardo || 0);

        const nominaExistente = await prisma.nominas.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha_inicio: fechaBusqueda, estatus: "PENDIENTE" }
        });

        let recibo;
        if (nominaExistente) {
            recibo = await prisma.nominas.update({
                where: { id_nomina: nominaExistente.id_nomina },
                data: {
                    horas_totales:            Number(nominaExistente.horas_totales || 0) + horasTrabajadas,
                    sueldo_bruto:             Number(nominaExistente.sueldo_bruto) + bruto,
                    total_descuentos_retardo: Number(nominaExistente.total_descuentos_retardo || 0) + Number(asistencia.descuento_retardo || 0),
                    total_neto:               Number(nominaExistente.total_neto || 0) + neto,
                    dias_trabajados:          nominaExistente.dias_trabajados || 1,
                    fecha_fin:                fechaBusqueda
                }
            });
        } else {
            recibo = await prisma.nominas.create({
                data: {
                    id_empleado:              BigInt(id_empleado),
                    fecha_inicio:             fechaBusqueda,
                    fecha_fin:                fechaBusqueda,
                    dias_trabajados:          1,
                    horas_totales:            horasTrabajadas,
                    sueldo_bruto:             bruto,
                    total_descuentos_retardo: asistencia.descuento_retardo || 0,
                    total_neto:               neto,
                    estatus:                  "PENDIENTE"
                }
            });
        }

        res.json(convertirBigInt({
            mensaje: "¡Salida marcada!",
            horas_registradas: horasTrabajadas,
            nomina_generada: recibo
        }));
    } catch (error) {
        console.error("Error al registrar salida:", error);
        res.status(500).json({ error: "Error en registro de salida" });
    }
});

app.put("/asistencias/justificar", async (req, res) => {
    try {
        const { id_empleado, fecha, motivo } = req.body;
        const fechaBusqueda = new Date(fecha.split('T')[0] + "T00:00:00");

        const asistencia = await prisma.asistencias.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha: fechaBusqueda, estatus: "FALTA" }
        });

        if (!asistencia) return res.status(404).json({ error: "No se encontró una FALTA para justificar." });

        const actualizada = await prisma.asistencias.update({
            where: { id_asistencia: asistencia.id_asistencia },
            data: { estatus: "JUSTIFICADA" }
        });

        res.json({ mensaje: "Falta justificada correctamente", asistencia: convertirBigInt(actualizada) });
    } catch (error) {
        res.status(500).json({ error: "Error al justificar la falta" });
    }
});

// ============================================================
// 5. RUTAS DE NÓMINA E INCIDENCIAS
// ============================================================

app.post("/nominas/incidencias", async (req, res) => {
    try {
        const { id_empleado, fecha, tipo, concepto, monto } = req.body;
        const fechaBusqueda = new Date(fecha + "T00:00:00");

        const nomina = await prisma.nominas.findFirst({
            where: { id_empleado: BigInt(id_empleado), fecha_inicio: fechaBusqueda, estatus: "PENDIENTE" }
        });

        if (!nomina) return res.status(404).json({ error: "No hay nómina pendiente ese día." });

        let dataUpdate   = {};
        const valorMonto = Number(monto);

        if (tipo === "PERCEPCION") {
            if (concepto.toUpperCase() === "BONO") dataUpdate.bonos = Number(nomina.bonos || 0) + valorMonto;
            else dataUpdate.otras_percepciones = Number(nomina.otras_percepciones || 0) + valorMonto;
        } else if (tipo === "DEDUCCION") {
            if (concepto.toUpperCase() === "COMIDA") dataUpdate.comidas = Number(nomina.comidas || 0) + valorMonto;
            else dataUpdate.otras_deducciones = Number(nomina.otras_deducciones || 0) + valorMonto;
        }

        const bonosN = dataUpdate.bonos              !== undefined ? dataUpdate.bonos              : Number(nomina.bonos || 0);
        const perN   = dataUpdate.otras_percepciones !== undefined ? dataUpdate.otras_percepciones : Number(nomina.otras_percepciones || 0);
        const comN   = dataUpdate.comidas            !== undefined ? dataUpdate.comidas            : Number(nomina.comidas || 0);
        const dedN   = dataUpdate.otras_deducciones  !== undefined ? dataUpdate.otras_deducciones  : Number(nomina.otras_deducciones || 0);

        dataUpdate.total_neto = Number(nomina.sueldo_bruto) + bonosN + perN - Number(nomina.total_descuentos_retardo || 0) - comN - dedN;

        const actualizada = await prisma.nominas.update({
            where: { id_nomina: nomina.id_nomina },
            data: dataUpdate
        });

        res.json({ mensaje: `Incidencia (${concepto}) aplicada.`, nomina_actualizada: convertirBigInt(actualizada) });
    } catch (error) {
        res.status(500).json({ error: "Error registrando la incidencia" });
    }
});

app.get("/nominas/acumulado/:id_empleado", async (req, res) => {
    try {
        const { id_empleado } = req.params;
        const pendientes = await prisma.nominas.findMany({
            where: { id_empleado: BigInt(id_empleado), estatus: "PENDIENTE" }
        });

        const total = pendientes.reduce((acc, n) => acc + Number(n.total_neto), 0);

        res.json(convertirBigInt({
            id_empleado,
            recibos_pendientes: pendientes.length,
            total_acumulado:    total.toFixed(2),
            detalle:            pendientes
        }));
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo acumulados" });
    }
});

app.post("/nominas/imprimir-y-pagar/:id_empleado", async (req, res) => {
    try {
        const { id_empleado } = req.params;

        const empleado = await prisma.empleados.findUnique({ where: { id_empleado: BigInt(id_empleado) } });
        if (!empleado) return res.status(404).json({ error: "Empleado no encontrado" });

        let nombreDepto = "No asignado", nombrePuesto = "No asignado";
        if (empleado.departamento_id) {
            const depto = await prisma.departamentos.findUnique({ where: { id_departamento: empleado.departamento_id } });
            if (depto) nombreDepto = depto.nombre;
        }
        if (empleado.puesto_id) {
            const puesto = await prisma.puestos.findUnique({ where: { id_puestos: empleado.puesto_id } });
            if (puesto) nombrePuesto = puesto.nombre;
        }

        const pendientes = await prisma.nominas.findMany({
            where: { id_empleado: BigInt(id_empleado), estatus: "PENDIENTE" }
        });

        if (pendientes.length === 0) return res.status(400).json({ error: "No hay pagos pendientes." });

        let totalBruto = 0, totalRetardos = 0, totalNeto = 0, diasPagados = 0;
        let totalBonos = 0, totalComidas = 0, totalOtrasPercepciones = 0, totalOtrasDeducciones = 0;

        pendientes.forEach(p => {
            totalBruto             += Number(p.sueldo_bruto);
            totalRetardos          += Number(p.total_descuentos_retardo);
            totalBonos             += Number(p.bonos || 0);
            totalComidas           += Number(p.comidas || 0);
            totalOtrasPercepciones += Number(p.otras_percepciones || 0);
            totalOtrasDeducciones  += Number(p.otras_deducciones || 0);
            totalNeto              += Number(p.total_neto);
            diasPagados            += Number(p.dias_trabajados);
        });

        if (empleado.Tipo_Pago?.toUpperCase() === "DIARIO") {
            diasPagados = pendientes.length;
        }

        const crearBloqueRecibo = () => {
            const sinBordes = {
                top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
                insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE }
            };

            return [
                new Paragraph({ children: [new TextRun({ text: "El Sauce Restaurante", bold: true, size: 28 })], alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "Av. Tamaulipas #702 Col. Héroe de Nacozari", alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "89520 Ciudad Madero Tamaulipas México", alignment: AlignmentType.CENTER }),
                new Paragraph({ children: [new TextRun({ text: "Recibo de Pago", bold: true, size: 24 })], alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "" }),
                new Paragraph({ text: `Empleado: ${empleado.nombre} ${empleado.apellido_paterno} ${empleado.apellido_materno || ''}` }),
                new Paragraph({ text: `CURP: ${empleado.curp || 'No registrado'}` }),
                new Paragraph({ text: `Frecuencia de Pago: ${empleado.Tipo_Pago || 'No registrado'}` }),
                new Paragraph({ text: `Departamento: ${nombreDepto}` }),
                new Paragraph({ text: `Puesto: ${nombrePuesto}` }),
                new Paragraph({ text: `Dias Pagados: ${diasPagados}` }),
                new Paragraph({ text: `Fecha de Emision: ${new Date().toLocaleDateString('es-MX')}` }),
                new Paragraph({ text: "" }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBordes,
                    rows: [
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Percepciones:", bold: true })] })] }),
                            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Deducciones:", bold: true })] })] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph(`Sueldo Bruto: $${totalBruto.toFixed(2)}`)] }),
                            new TableCell({ children: [new Paragraph(`Retardos: $${totalRetardos.toFixed(2)}`)] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph(`Bonos: $${totalBonos.toFixed(2)}`)] }),
                            new TableCell({ children: [new Paragraph(`Comidas: $${totalComidas.toFixed(2)}`)] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph(`Otros: $${totalOtrasPercepciones.toFixed(2)}`)] }),
                            new TableCell({ children: [new Paragraph(`Otros: $${totalOtrasDeducciones.toFixed(2)}`)] }),
                        ]}),
                    ],
                }),
                new Paragraph({ text: "" }),
                new Paragraph({ children: [new TextRun({ text: `Sueldo Neto: $${totalNeto.toFixed(2)}`, bold: true, size: 24 })] }),
                new Paragraph({ text: "" }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE }, borders: sinBordes,
                    rows: [
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })] }),
                            new TableCell({ children: [new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })] }),
                        ]}),
                        new TableRow({ children: [
                            new TableCell({ children: [new Paragraph({ text: "Nombre y Firma del Empleado", alignment: AlignmentType.CENTER })] }),
                            new TableCell({ children: [new Paragraph({ text: "El Sauce Restaurante", alignment: AlignmentType.CENTER })] }),
                        ]}),
                    ]
                }),
                new Paragraph({ text: "" }),
                new Paragraph({
                    children: [new TextRun({
                        text: `"Recibí a mi entera satisfacción la cantidad neta que este recibo indica por concepto de salarios, séptimo día y prestaciones devengadas en el periodo señalado. Reconozco que con este pago queda cubierto el total de las percepciones a las que tengo derecho hasta la fecha, sin que se me adeude cantidad alguna por horas extra, descansos trabajados o cualquier otro concepto laboral, otorgando el finiquito más amplio que en derecho proceda respecto a este periodo."`,
                        size: 16,
                    })],
                    alignment: AlignmentType.JUSTIFIED
                }),
            ];
        };

        const doc = new Document({
            styles: { default: { document: { run: { size: 20, font: "Arial" } } } },
            sections: [{
                properties: {},
                children: [
                    ...crearBloqueRecibo(),
                    new Paragraph({ text: "" }),
                    new Paragraph({ text: "- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -", alignment: AlignmentType.CENTER }),
                    new Paragraph({ text: "" }),
                    ...crearBloqueRecibo()
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);

        await prisma.nominas.updateMany({
            where: { id_empleado: BigInt(id_empleado), estatus: "PENDIENTE" },
            data: { estatus: "PAGADO", fecha_pago: new Date() }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=Recibo_${empleado.nombre}.docx`);
        res.send(buffer);

    } catch (error) {
        console.error("Error imprimiendo formato:", error);
        res.status(500).json({ error: "Hubo un error generando tu recibo." });
    }
});

// Historial de pagos: todas las nóminas PAGADO (más recientes primero).
// Los pagos anteriores a esta función no tienen fecha_pago (viene null).
app.get("/nominas/historial", async (req, res) => {
    try {
        const pagadas = await prisma.nominas.findMany({
            where: { estatus: "PAGADO" },
            include: { empleados: { select: { nombre: true, apellido_paterno: true, apellido_materno: true } } },
            orderBy: [
                { fecha_pago: { sort: "desc", nulls: "last" } },
                { fecha_fin: "desc" }
            ]
        });
        res.json(convertirBigInt(pagadas));
    } catch (error) {
        console.error("Error historial:", error);
        res.status(500).json({ error: "Error obteniendo el historial de pagos" });
    }
});

// ============================================================
// 5B. LOGIN Y USUARIOS
// ============================================================

// Freno a intentos fallidos: 5 fallos seguidos -> bloqueo de 15 minutos (por usuario)
const intentosLogin = new Map();
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

async function verificarPassword(usuario, passwordIngresado) {
    const guardado = usuario.password || "";
    if (guardado.startsWith("$2")) {
        return bcrypt.compare(passwordIngresado, guardado);
    }
    // Contraseña vieja en texto plano: si coincide, se convierte a hash automáticamente.
    if (guardado === passwordIngresado) {
        const hash = await bcrypt.hash(passwordIngresado, 10);
        await prisma.usuarios.update({ where: { id_usuario: usuario.id_usuario }, data: { password: hash } });
        return true;
    }
    return false;
}

app.post("/auth/login", async (req, res) => {
    try {
        if (!JWT_SECRET) return res.status(500).json({ error: "Falta configurar JWT_SECRET en el servidor" });

        const { username, password } = req.body || {};
        if (!username || !password) return res.status(400).json({ error: "Escribe usuario y contraseña" });

        const clave = String(username).toLowerCase();
        const registro = intentosLogin.get(clave);
        if (registro && registro.bloqueadoHasta && registro.bloqueadoHasta > Date.now()) {
            return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
        }

        const usuario = await prisma.usuarios.findFirst({
            where: { username: { equals: String(username), mode: "insensitive" } }
        });
        const ok = usuario && usuario.activo && await verificarPassword(usuario, String(password));

        if (!ok) {
            const r = registro && !(registro.bloqueadoHasta && registro.bloqueadoHasta <= Date.now())
                ? registro : { fallos: 0, bloqueadoHasta: 0 };
            r.fallos += 1;
            if (r.fallos >= MAX_INTENTOS) { r.bloqueadoHasta = Date.now() + BLOQUEO_MS; r.fallos = 0; }
            intentosLogin.set(clave, r);
            return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
        }

        intentosLogin.delete(clave);
        const datos = { id: Number(usuario.id_usuario), username: usuario.username, rol: usuario.rol };
        const token = jwt.sign(datos, JWT_SECRET, { expiresIn: `${DIAS_SESION}d` });
        res.json({ token, usuario: datos });
    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ error: "Error iniciando sesión" });
    }
});

app.get("/auth/me", (req, res) => {
    if (!req.usuario) return res.status(401).json({ error: "No autenticado" });
    // Devuelve un token nuevo para extender la sesión otros 30 días
    const token = jwt.sign(
        { id: req.usuario.id, username: req.usuario.username, rol: req.usuario.rol },
        JWT_SECRET,
        { expiresIn: `${DIAS_SESION}d` }
    );
    res.json({ usuario: req.usuario, token });
});

// --- Administración de usuarios (solo ADMIN, por la regla de permisos) ---

app.get("/usuarios", async (req, res) => {
    try {
        const lista = await prisma.usuarios.findMany({
            select: { id_usuario: true, username: true, rol: true, activo: true, created_at: true },
            orderBy: { id_usuario: "asc" }
        });
        res.json(convertirBigInt(lista));
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo usuarios" });
    }
});

app.post("/usuarios", async (req, res) => {
    try {
        const { username, password, rol } = req.body || {};
        const nombre = String(username || "").trim();
        if (!nombre) return res.status(400).json({ error: "Falta el nombre de usuario" });
        if (!password || String(password).length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
        if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: "Rol inválido" });

        const existe = await prisma.usuarios.findFirst({ where: { username: { equals: nombre, mode: "insensitive" } } });
        if (existe) return res.status(400).json({ error: "Ya existe un usuario con ese nombre" });

        const hash = await bcrypt.hash(String(password), 10);
        const nuevo = await prisma.usuarios.create({
            data: { username: nombre, password: hash, rol, activo: true },
            select: { id_usuario: true, username: true, rol: true, activo: true }
        });
        res.json(convertirBigInt(nuevo));
    } catch (error) {
        console.error("Error creando usuario:", error);
        res.status(500).json({ error: "Error creando usuario" });
    }
});

app.put("/usuarios/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { password, rol, activo } = req.body || {};
        const actual = await prisma.usuarios.findUnique({ where: { id_usuario: BigInt(id) } });
        if (!actual) return res.status(404).json({ error: "Usuario no encontrado" });

        const data = {};
        if (password !== undefined && password !== "") {
            if (String(password).length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
            data.password = await bcrypt.hash(String(password), 10);
        }
        if (rol !== undefined) {
            if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: "Rol inválido" });
            data.rol = rol;
        }
        if (activo !== undefined) data.activo = Boolean(activo);

        // Que nunca te quedes sin un ADMIN activo
        const dejaDeSerAdminActivo = actual.rol === "ADMIN" && actual.activo &&
            ((data.rol && data.rol !== "ADMIN") || data.activo === false);
        if (dejaDeSerAdminActivo) {
            const otros = await prisma.usuarios.count({
                where: { rol: "ADMIN", activo: true, id_usuario: { not: BigInt(id) } }
            });
            if (otros === 0) return res.status(400).json({ error: "Debe quedar al menos un ADMIN activo" });
        }

        await prisma.usuarios.update({ where: { id_usuario: BigInt(id) }, data });
        cacheUsuarios.delete(id);
        res.json({ mensaje: "Usuario actualizado" });
    } catch (error) {
        console.error("Error actualizando usuario:", error);
        res.status(500).json({ error: "Error actualizando usuario" });
    }
});

// ============================================================
// 6. RUTAS DE DESCANSOS
// ============================================================

// Obtener días de descanso de un empleado
app.get("/descansos/:id_empleado", async (req, res) => {
    try {
        const descansos = await prisma.descansos_empleados.findMany({
            where: { id_empleado: BigInt(req.params.id_empleado) }
        });
        res.json(convertirBigInt(descansos));
    } catch (error) {
        res.status(500).json({ error: "Error obteniendo descansos" });
    }
});

// Asignar día de descanso a un empleado
app.post("/descansos", async (req, res) => {
    try {
        const { id_empleado, dia_semana } = req.body;

        if (!id_empleado || dia_semana === undefined) {
            return res.status(400).json({ error: "Faltan campos: id_empleado, dia_semana" });
        }

        // Verificar que no exista ya ese día para ese empleado
        const existe = await prisma.descansos_empleados.findFirst({
            where: { id_empleado: BigInt(id_empleado), dia_semana: parseInt(dia_semana) }
        });

        if (existe) {
            return res.status(400).json({ error: "Este día de descanso ya está asignado" });
        }

        const nuevo = await prisma.descansos_empleados.create({
            data: {
                id_empleado: BigInt(id_empleado),
                dia_semana:  parseInt(dia_semana),
            }
        });

        res.json(convertirBigInt(nuevo));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error asignando descanso" });
    }
});

// Eliminar día de descanso
app.delete("/descansos/:id_descanso", async (req, res) => {
    try {
        await prisma.descansos_empleados.delete({
            where: { id_descansos: parseInt(req.params.id_descanso) }
        });
        res.json({ mensaje: "Día de descanso eliminado" });
    } catch (error) {
        res.status(500).json({ error: "Error eliminando descanso" });
    }
});

// ============================================================
// 7. LANZAMIENTO DEL SERVIDOR
// ============================================================

async function startServer() {
    try {
        await prisma.$connect();
        console.log("Conexión a DB exitosa");
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor corriendo en el puerto ${PORT}`);
        });
    } catch (error) {
        console.error("Error al conectar a DB:", error);
        process.exit(1);
    }
}

startServer();