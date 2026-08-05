/**
 * Static catalogues backing the multi-select controls in the signup flow.
 *
 * These live in code rather than the database on purpose: they change at the pace of
 * product decisions, not user actions, and shipping them as data would mean a seeder,
 * a migration and an admin CRUD surface for a list that is edited twice a year. The
 * values are the canonical strings stored on `users.interests` and `groups.category`,
 * so the client never has to invent one.
 */

export interface InterestOption {
    /** Stored value — lowercase, matches the normalisation in UserService.updateInterests. */
    value: string;
    label: string;
    group: string;
}

export interface StateOption {
    state: string;
    cities: string[];
}

export const INTEREST_CATALOG: InterestOption[] = [
    { value: 'football',        label: 'Football',            group: 'Sports & Fitness' },
    { value: 'basketball',      label: 'Basketball',          group: 'Sports & Fitness' },
    { value: 'running',         label: 'Running',             group: 'Sports & Fitness' },
    { value: 'cycling',         label: 'Cycling',             group: 'Sports & Fitness' },
    { value: 'gym',             label: 'Gym & Weightlifting', group: 'Sports & Fitness' },
    { value: 'martial_arts',    label: 'Martial Arts',        group: 'Sports & Fitness' },
    { value: 'hiking',          label: 'Hiking & Outdoors',   group: 'Sports & Fitness' },

    { value: 'books',           label: 'Books & Reading',     group: 'Arts & Culture' },
    { value: 'writing',         label: 'Writing',             group: 'Arts & Culture' },
    { value: 'music',           label: 'Music',               group: 'Arts & Culture' },
    { value: 'film',            label: 'Film & TV',           group: 'Arts & Culture' },
    { value: 'photography',     label: 'Photography',         group: 'Arts & Culture' },
    { value: 'art',             label: 'Art & Design',        group: 'Arts & Culture' },
    { value: 'theatre',         label: 'Theatre & Comedy',    group: 'Arts & Culture' },
    { value: 'fashion',         label: 'Fashion',             group: 'Arts & Culture' },

    { value: 'tech',            label: 'Tech',                group: 'Career & Learning' },
    { value: 'startups',        label: 'Startups',            group: 'Career & Learning' },
    { value: 'design',          label: 'Product & UX',        group: 'Career & Learning' },
    { value: 'finance',         label: 'Finance & Investing', group: 'Career & Learning' },
    { value: 'entrepreneurship',label: 'Entrepreneurship',    group: 'Career & Learning' },
    { value: 'languages',       label: 'Languages',           group: 'Career & Learning' },
    { value: 'public_speaking', label: 'Public Speaking',     group: 'Career & Learning' },

    { value: 'faith',           label: 'Faith & Spirituality',group: 'Community' },
    { value: 'volunteering',    label: 'Volunteering',        group: 'Community' },
    { value: 'parenting',       label: 'Parenting',           group: 'Community' },
    { value: 'alumni',          label: 'Alumni Networks',     group: 'Community' },
    { value: 'women',           label: "Women's Groups",      group: 'Community' },
    { value: 'youth',           label: 'Youth',               group: 'Community' },

    { value: 'food',            label: 'Food & Cooking',      group: 'Lifestyle' },
    { value: 'travel',          label: 'Travel',              group: 'Lifestyle' },
    { value: 'gaming',          label: 'Gaming',              group: 'Lifestyle' },
    { value: 'board_games',     label: 'Board Games',         group: 'Lifestyle' },
    { value: 'wellness',        label: 'Health & Wellness',   group: 'Lifestyle' },
    { value: 'pets',            label: 'Pets',                group: 'Lifestyle' },
    { value: 'gardening',       label: 'Gardening',           group: 'Lifestyle' },
];

/**
 * Nigeria's 36 states plus the FCT. `cities` lists the population centres a group is
 * likely to be based in, not an exhaustive gazetteer — the field stays free text, so
 * anything missing can still be typed in.
 */
export const NIGERIA_STATES: StateOption[] = [
    { state: 'Abia',        cities: ['Umuahia', 'Aba', 'Ohafia'] },
    { state: 'Adamawa',     cities: ['Yola', 'Mubi', 'Numan'] },
    { state: 'Akwa Ibom',   cities: ['Uyo', 'Eket', 'Ikot Ekpene'] },
    { state: 'Anambra',     cities: ['Awka', 'Onitsha', 'Nnewi'] },
    { state: 'Bauchi',      cities: ['Bauchi', 'Azare', 'Misau'] },
    { state: 'Bayelsa',     cities: ['Yenagoa', 'Ogbia', 'Sagbama'] },
    { state: 'Benue',       cities: ['Makurdi', 'Gboko', 'Otukpo'] },
    { state: 'Borno',       cities: ['Maiduguri', 'Biu', 'Bama'] },
    { state: 'Cross River', cities: ['Calabar', 'Ugep', 'Ogoja'] },
    { state: 'Delta',       cities: ['Asaba', 'Warri', 'Sapele', 'Ughelli'] },
    { state: 'Ebonyi',      cities: ['Abakaliki', 'Afikpo'] },
    { state: 'Edo',         cities: ['Benin City', 'Auchi', 'Ekpoma'] },
    { state: 'Ekiti',       cities: ['Ado-Ekiti', 'Ikere-Ekiti', 'Ikole-Ekiti'] },
    { state: 'Enugu',       cities: ['Enugu', 'Nsukka', 'Agbani'] },
    { state: 'FCT',         cities: ['Abuja', 'Gwagwalada', 'Kuje', 'Bwari'] },
    { state: 'Gombe',       cities: ['Gombe', 'Kumo', 'Billiri'] },
    { state: 'Imo',         cities: ['Owerri', 'Orlu', 'Okigwe'] },
    { state: 'Jigawa',      cities: ['Dutse', 'Hadejia', 'Gumel'] },
    { state: 'Kaduna',      cities: ['Kaduna', 'Zaria', 'Kafanchan'] },
    { state: 'Kano',        cities: ['Kano', 'Wudil', 'Gaya'] },
    { state: 'Katsina',     cities: ['Katsina', 'Daura', 'Funtua'] },
    { state: 'Kebbi',       cities: ['Birnin Kebbi', 'Argungu', 'Yauri'] },
    { state: 'Kogi',        cities: ['Lokoja', 'Okene', 'Idah'] },
    { state: 'Kwara',       cities: ['Ilorin', 'Offa', 'Jebba'] },
    { state: 'Lagos',       cities: ['Ikeja', 'Lagos Island', 'Lekki', 'Yaba', 'Surulere', 'Ikorodu', 'Badagry', 'Epe'] },
    { state: 'Nasarawa',    cities: ['Lafia', 'Keffi', 'Akwanga'] },
    { state: 'Niger',       cities: ['Minna', 'Bida', 'Suleja'] },
    { state: 'Ogun',        cities: ['Abeokuta', 'Ijebu-Ode', 'Sagamu', 'Ota'] },
    { state: 'Ondo',        cities: ['Akure', 'Ondo City', 'Owo'] },
    { state: 'Osun',        cities: ['Osogbo', 'Ile-Ife', 'Ilesa'] },
    { state: 'Oyo',         cities: ['Ibadan', 'Ogbomoso', 'Oyo', 'Iseyin'] },
    { state: 'Plateau',     cities: ['Jos', 'Bukuru', 'Pankshin'] },
    { state: 'Rivers',      cities: ['Port Harcourt', 'Bonny', 'Bori'] },
    { state: 'Sokoto',      cities: ['Sokoto', 'Tambuwal', 'Bodinga'] },
    { state: 'Taraba',      cities: ['Jalingo', 'Wukari', 'Bali'] },
    { state: 'Yobe',        cities: ['Damaturu', 'Potiskum', 'Gashua'] },
    { state: 'Zamfara',     cities: ['Gusau', 'Kaura Namoda', 'Talata Mafara'] },
];

/** Categories a group can be filed under. Mirrors the interest catalogue's top level. */
export const GROUP_CATEGORIES: string[] = [
    'Sports & Fitness',
    'Arts & Culture',
    'Career & Learning',
    'Community',
    'Lifestyle',
    'Faith',
    'Education',
    'Social',
];
