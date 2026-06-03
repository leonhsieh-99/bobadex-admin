import type { PageServerLoad } from './$types';

type RegionCodeRow = {
  code: string;
  country_code: string;
  region_name: string;
};

export const load: PageServerLoad = async ({ locals }) => {
  const { data: regionCodes } = await locals.supabase
    .from('region_codes')
    .select('code,country_code,region_name')
    .order('code', { ascending: true });

  return {
    regionCodes: (regionCodes ?? []) as RegionCodeRow[]
  };
};
