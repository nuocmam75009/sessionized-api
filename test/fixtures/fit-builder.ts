// Générateur de fichiers .fit synthétiques pour les tests.
//
// Le fichier réel de la piste (Piste…fit) reste hors du dépôt : c'est une
// trace GPS personnelle. Ce générateur écrit un .fit valide (protocole FIT
// 2.0, CRC compris) avec les seuls messages que lit l'API : file_id, record,
// lap, session et activity. Les valeurs sont déterministes : un même appel
// produit les mêmes octets, donc le même hash SHA-256 de déduplication.

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);

// Types de base FIT (Profile.xlsx, onglet « Types »).
const ENUM = 0x00;
const UINT8 = 0x02;
const UINT16 = 0x84;
const SINT32 = 0x85;
const UINT32 = 0x86;

const SIZE: Record<number, number> = {
  [ENUM]: 1,
  [UINT8]: 1,
  [UINT16]: 2,
  [SINT32]: 4,
  [UINT32]: 4,
};

// Numéros de message global.
const FILE_ID = 0;
const SESSION = 18;
const LAP = 19;
const RECORD = 20;
const ACTIVITY = 34;

type Field = [fieldNumber: number, baseType: number];

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001,
  0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

class FitWriter {
  private readonly chunks: Buffer[] = [];

  define(localType: number, globalMessage: number, fields: Field[]): void {
    const header = Buffer.alloc(6 + fields.length * 3);
    header.writeUInt8(0x40 | localType, 0); // message de définition
    header.writeUInt8(0, 1); // réservé
    header.writeUInt8(0, 2); // petit-boutiste
    header.writeUInt16LE(globalMessage, 3);
    header.writeUInt8(fields.length, 5);
    fields.forEach(([fieldNumber, baseType], i) => {
      header.writeUInt8(fieldNumber, 6 + i * 3);
      header.writeUInt8(SIZE[baseType], 7 + i * 3);
      header.writeUInt8(baseType, 8 + i * 3);
    });
    this.chunks.push(header);
  }

  data(localType: number, fields: Field[], values: number[]): void {
    const size = fields.reduce((sum, [, type]) => sum + SIZE[type], 0);
    const buffer = Buffer.alloc(1 + size);
    buffer.writeUInt8(localType, 0);
    let offset = 1;
    fields.forEach(([, type], i) => {
      const value = Math.round(values[i]);
      if (type === ENUM || type === UINT8) buffer.writeUInt8(value, offset);
      else if (type === UINT16) buffer.writeUInt16LE(value, offset);
      else if (type === SINT32) buffer.writeInt32LE(value, offset);
      else buffer.writeUInt32LE(value, offset);
      offset += SIZE[type];
    });
    this.chunks.push(buffer);
  }

  toBuffer(): Buffer {
    const body = Buffer.concat(this.chunks);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1); // protocole 2.0
    header.writeUInt16LE(2132, 2); // version du profil 21.32
    header.writeUInt32LE(body.length, 4);
    header.write('.FIT', 8, 'ascii');
    header.writeUInt16LE(fitCrc(header.subarray(0, 12)), 12);
    const withoutCrc = Buffer.concat([header, body]);
    const crc = Buffer.alloc(2);
    crc.writeUInt16LE(fitCrc(withoutCrc), 0);
    return Buffer.concat([withoutCrc, crc]);
  }
}

export interface SyntheticFitOptions {
  /** Départ de la séance. */
  startedAt?: Date;
  /** Nombre de laps de 400 m. */
  laps?: number;
  /** Allure de chaque lap, en secondes pour 400 m. */
  lapSeconds?: number;
  /** Échantillons par lap (un toutes les `lapSeconds / samplesPerLap` s). */
  samplesPerLap?: number;
  /** Fréquence cardiaque moyenne. */
  heartRate?: number;
}

const toFitTime = (date: Date) =>
  Math.round((date.getTime() - FIT_EPOCH_MS) / 1000);
// Degrés → semi-cercles, l'unité des positions dans un .fit.
const toSemicircles = (degrees: number) => (degrees * 2 ** 31) / 180;

/**
 * Séance de fractionné sur piste : `laps` × 400 m à allure constante, avec
 * une trace GPS en ligne droite (aucune position réelle) et une FC stable.
 */
export function buildSyntheticFit(options: SyntheticFitOptions = {}): Buffer {
  const startedAt = options.startedAt ?? new Date('2026-10-15T07:00:00Z');
  const laps = options.laps ?? 4;
  const lapSeconds = options.lapSeconds ?? 90;
  const samplesPerLap = options.samplesPerLap ?? 10;
  const heartRate = options.heartRate ?? 150;

  const lapDistanceM = 400;
  const speed = lapDistanceM / lapSeconds;
  const start = toFitTime(startedAt);
  const totalSeconds = laps * lapSeconds;

  const writer = new FitWriter();

  const fileIdFields: Field[] = [
    [0, ENUM], // type : activity
    [1, UINT16], // manufacturer : development
    [4, UINT32], // time_created
  ];
  writer.define(0, FILE_ID, fileIdFields);
  writer.data(0, fileIdFields, [4, 255, start]);

  const recordFields: Field[] = [
    [253, UINT32], // timestamp
    [0, SINT32], // position_lat
    [1, SINT32], // position_long
    [5, UINT32], // distance, en cm
    [6, UINT16], // speed, en mm/s
    [3, UINT8], // heart_rate
    [4, UINT8], // cadence
  ];
  const lapFields: Field[] = [
    [253, UINT32], // timestamp
    [2, UINT32], // start_time
    [7, UINT32], // total_elapsed_time, en ms
    [9, UINT32], // total_distance, en cm
    [13, UINT16], // avg_speed, en mm/s
    [15, UINT8], // avg_heart_rate
    [16, UINT8], // max_heart_rate
  ];
  writer.define(1, RECORD, recordFields);
  writer.define(2, LAP, lapFields);

  const step = lapSeconds / samplesPerLap;
  for (let lap = 0; lap < laps; lap++) {
    const lapStart = start + lap * lapSeconds;
    for (let i = 1; i <= samplesPerLap; i++) {
      const elapsed = lap * lapSeconds + i * step;
      const distanceM = speed * elapsed;
      writer.data(1, recordFields, [
        start + elapsed,
        toSemicircles(45 + distanceM / 111_000),
        toSemicircles(5),
        distanceM * 100,
        speed * 1000,
        heartRate,
        88,
      ]);
    }
    writer.data(2, lapFields, [
      lapStart + lapSeconds,
      lapStart,
      lapSeconds * 1000,
      lapDistanceM * 100,
      speed * 1000,
      heartRate,
      heartRate + 8,
    ]);
  }

  const sessionFields: Field[] = [
    [253, UINT32], // timestamp
    [2, UINT32], // start_time
    [7, UINT32], // total_elapsed_time, en ms
    [9, UINT32], // total_distance, en cm
    [5, ENUM], // sport : running
    [6, ENUM], // sub_sport : track
    [16, UINT8], // avg_heart_rate
    [17, UINT8], // max_heart_rate
  ];
  writer.define(3, SESSION, sessionFields);
  writer.data(3, sessionFields, [
    start + totalSeconds,
    start,
    totalSeconds * 1000,
    laps * lapDistanceM * 100,
    1,
    4,
    heartRate,
    heartRate + 8,
  ]);

  const activityFields: Field[] = [
    [253, UINT32], // timestamp
    [1, UINT16], // num_sessions
    [2, ENUM], // type : manual
    [3, ENUM], // event : activity
    [4, ENUM], // event_type : stop
  ];
  writer.define(4, ACTIVITY, activityFields);
  writer.data(4, activityFields, [start + totalSeconds, 1, 0, 26, 1]);

  return writer.toBuffer();
}
