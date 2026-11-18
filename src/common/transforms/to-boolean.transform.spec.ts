import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListActivitiesQueryDto } from '../../activities/dto/list-activities-query.dto';

// Query string telle que la reçoit le ValidationPipe (`transform: true`).
async function parse(query: Record<string, string>) {
  const dto = plainToInstance(ListActivitiesQueryDto, query);
  return { dto, errors: await validate(dto) };
}

describe('ToBoolean', () => {
  it('"true" devient true', async () => {
    const { dto, errors } = await parse({ training: 'true' });
    expect(errors).toHaveLength(0);
    expect(dto.training).toBe(true);
  });

  it('"false" devient false, pas true comme avec Boolean("false")', async () => {
    const { dto, errors } = await parse({ training: 'false' });
    expect(errors).toHaveLength(0);
    expect(dto.training).toBe(false);
  });

  it('toute autre valeur est refusée plutôt que devinée', async () => {
    const { errors } = await parse({ training: '1' });
    expect(errors.map((e) => e.property)).toEqual(['training']);
  });

  it('absent : pas de filtre', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto.training).toBeUndefined();
  });
});
