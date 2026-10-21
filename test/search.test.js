import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, approvedBiodata, userWithAgent } from './helpers.js';

describe('biodata search', () => {
  it('filters by upazila, present address and special category', async () => {
    const a = await approvedBiodata({
      index: 0,
      overrides: {
        address: {
          permanentDivision: 'dhaka',
          permanentDistrict: 'dhaka',
          permanentUpazila: 'dhaka_dhaka_south_cc',
          presentLocation: 'bangladesh',
          presentDistrict: 'gazipur',
          presentUpazila: 'gazipur_kaliakair',
        },
        personal: { specialCategories: ['orphan'] },
      },
    });
    await approvedBiodata({ index: 1 });

    const byUpazila = await request(app).get('/api/biodatas?upazila=dhaka_dhaka_south_cc');
    expect(byUpazila.body.items.map((b) => b.biodataNo)).toEqual([a.biodata.biodataNo]);

    const byPresent = await request(app).get('/api/biodatas?presentUpazila=gazipur_kaliakair');
    expect(byPresent.body.items.map((b) => b.biodataNo)).toEqual([a.biodata.biodataNo]);

    const byCategory = await request(app).get('/api/biodatas?category=orphan');
    expect(byCategory.body.items.map((b) => b.biodataNo)).toEqual([a.biodata.biodataNo]);
  });

  it('counts biodatas per place for the location picker', async () => {
    await approvedBiodata({
      index: 2,
      overrides: {
        address: {
          permanentDivision: 'sylhet',
          permanentDistrict: 'sylhet',
          permanentUpazila: 'sylhet_sylhet_cc',
        },
      },
    });
    const res = await request(app).get('/api/biodatas/location-counts');
    expect(res.status).toBe(200);
    expect(res.body.divisions.sylhet).toBeGreaterThanOrEqual(1);
    expect(res.body.districts.sylhet).toBeGreaterThanOrEqual(1);
    expect(res.body.upazilas.sylhet_sylhet_cc).toBe(1);

    const present = await request(app).get('/api/biodatas/location-counts?scope=present');
    expect(present.body.scope).toBe('present');
  });

  it('sorts oldest first and marks biodatas the viewer has opened', async () => {
    const { agent } = await userWithAgent();
    const first = await approvedBiodata({ index: 3 });
    const newest = await request(app).get('/api/biodatas?sort=newest');
    const oldest = await request(app).get('/api/biodatas?sort=oldest');
    expect(oldest.body.items[0].biodataNo).not.toBe(newest.body.items[0].biodataNo);

    await agent.post(`/api/biodatas/${first.biodata.biodataNo}/visit`).expect(200);
    const seen = await agent.get('/api/biodatas?limit=48');
    const card = seen.body.items.find((b) => b.biodataNo === first.biodata.biodataNo);
    expect(card.seen).toBe(true);
    expect(seen.body.items.filter((b) => b.seen)).toHaveLength(1);
  });

  it('shows only the month and year of birth publicly', async () => {
    const { biodata, sections } = await approvedBiodata({ index: 4 });
    const res = await request(app).get(`/api/biodatas/${biodata.biodataNo}`);
    expect(res.body.biodata.sections.general.dateOfBirth).toBe(sections.general.dateOfBirth.slice(0, 7));
    // The owner's verified email shows as a badge; the address itself stays private.
    expect(res.body.biodata.verified).toEqual({ email: true, phone: false });
    expect(JSON.stringify(res.body)).not.toContain('@example.com');
  });
});
