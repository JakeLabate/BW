insert into field_groups (key, label, blurb, sort) values
('identity','Identity','Who the business is and why it exists.',10),
('offer','What you sell','Services, products, pricing and what makes you different.',20),
('audience','Who you serve','The customer, their problems and their hesitations.',30),
('operations','Contact and hours','How people reach you and when.',40),
('voice','Voice','How this business writes, in its own words.',50),
('proof','Proof','Reviews, credentials and work worth pointing at.',60),
('calendar','Calendar','Seasons, recurring events and what is coming up.',70),
('team','Team','The people customers deal with.',80),
('promotions','Offers and promotions','Current deals, loyalty and referrals.',90),
('faq','Questions customers ask','The things people ask before they buy.',100),
('locations','Locations','Premises, parking and access.',110),
('listings','Listings and neighborhoods','Property types, areas covered and how a sale runs.',200),
('re_license','License and brokerage','License, brokerage and designations.',210),
('inventory','Inventory','What is on the lot and what moves.',220),
('financing','Financing and trade-in','How customers pay and what you take in part exchange.',230),
('service_dept','Service department','Servicing, parts and loaners.',240),
('emergency','Emergency and callouts','Out of hours work and how fast you get there.',250),
('licensing','Licenses and insurance','Trade licenses, insurance and bonding.',260),
('projects','Projects and portfolio','Job types, past work and permits.',270),
('menu','Menu','Dishes, drinks, dietary options and price point.',280),
('reservations','Reservations and events','Booking, private hire and catering.',290),
('catalog','Product catalog','Categories, brands carried and bestsellers.',300),
('shipping','Shipping and returns','Delivery terms and how returns work.',310),
('practice_areas','Practice areas','Matter types, engagement model and fees.',320),
('clinical','Treatments and insurance','What you treat, what you accept, how to start.',330),
('classes','Classes and memberships','Timetable, tiers and trial offers.',340),
('salon_services','Service menu','Treatments, stylists and booking lead time.',350)
on conflict (key) do nothing;

insert into industries (key, label, blurb, sort) values
('home_services','Home services and trades','Plumbing, HVAC, electrical, landscaping, cleaning.',10),
('real_estate','Real estate','Agents, brokerages and property management.',20),
('auto','Auto dealership and repair','Sales, servicing and body shops.',30),
('food','Restaurant, cafe and food','Anywhere people eat or order from.',40),
('retail','Retail and ecommerce','Shops and online stores.',50),
('professional','Professional services','Law, accounting, consulting, agencies.',60),
('health','Health, dental and wellness','Clinics and practices.',70),
('beauty','Salon, spa and barber','Hair, nails, skin, grooming.',80),
('fitness','Gym and fitness','Studios, gyms and coaches.',90),
('construction','Construction and contracting','Builders, remodellers and specialty trades.',100),
('other','Something else','The universal profile with nothing industry specific bolted on.',999)
on conflict (key) do nothing;

-- every industry gets the universal modules
insert into industry_modules (industry_key, group_key, tier, sort)
select i.key, m.group_key, m.tier, m.sort
from industries i
cross join (values
  ('identity',0,10),('offer',0,20),('audience',0,30),('operations',0,40),
  ('voice',1,50),('proof',1,60),('calendar',1,70),
  ('team',2,80),('promotions',2,90),('faq',2,100),('locations',2,110)
) as m(group_key, tier, sort)
on conflict do nothing;

-- industry specific additions
insert into industry_modules (industry_key, group_key, tier, sort) values
('real_estate','listings',0,200),
('real_estate','re_license',1,210),
('auto','inventory',0,200),
('auto','financing',1,210),
('auto','service_dept',2,220),
('home_services','emergency',0,200),
('home_services','licensing',1,210),
('home_services','projects',2,220),
('construction','projects',0,200),
('construction','licensing',1,210),
('food','menu',0,200),
('food','reservations',1,210),
('retail','catalog',0,200),
('retail','shipping',1,210),
('professional','practice_areas',0,200),
('health','clinical',0,200),
('beauty','salon_services',0,200),
('fitness','classes',0,200)
on conflict do nothing;

-- a few industries lean on universal modules earlier than the default
update industry_modules set tier = 1 where industry_key in ('professional','health') and group_key = 'team';
update industry_modules set tier = 1 where industry_key in ('food','beauty','fitness','retail') and group_key = 'locations';
update industry_modules set tier = 1 where industry_key in ('retail','food') and group_key = 'promotions';

-- existing fields move into modules, then the column that replaced them goes
update field_defs set group_key = 'identity'   where key in ('legal_name','trading_name','one_liner','founded_year','owner_story','mission');
update field_defs set group_key = 'offer'      where key in ('services','pricing','service_area','lead_times','guarantees','differentiators');
update field_defs set group_key = 'audience'   where key in ('ideal_customer','customer_problems','objections','competitors');
update field_defs set group_key = 'proof'      where key in ('reviews_summary','case_examples','credentials');
update field_defs set group_key = 'team'       where key in ('team');
update field_defs set group_key = 'voice'      where key in ('tone','vocabulary','banned_words','post_examples');
update field_defs set group_key = 'operations' where key in ('hours','contact_phone','contact_email','address','booking_url','social_handles');
update field_defs set group_key = 'calendar'   where key in ('seasonality','recurring_events','announcements');

alter table field_defs alter column group_key set not null;
alter table field_defs drop column category;

-- fields belonging to the expansion and industry modules
insert into field_defs (key, group_key, label, help, required, multi, sort) values
('team_bios','team','Who does what','One per person. Name, role, and one thing worth saying about them.',false,true,810),
('hiring','team','Roles you are hiring for',null,false,true,820),
('current_promos','promotions','Running promotions','What it is, what it saves, when it ends.',false,true,910),
('loyalty','promotions','Loyalty or repeat customer deal',null,false,false,920),
('referral_offer','promotions','Referral offer',null,false,false,930),
('faq_items','faq','Questions you answer every week','One per fact. Question and the honest answer.',false,true,1010),
('policies','faq','Policies worth stating','Cancellation, deposits, rescheduling.',false,true,1020),
('locations_list','locations','Locations','One per site, with what is different about each.',false,true,1110),
('parking','locations','Parking and getting there',null,false,false,1120),
('accessibility','locations','Accessibility',null,false,false,1130),
('listing_types','listings','Property types you handle','Single family, condo, multi family, land, commercial.',true,true,2010),
('neighborhoods','listings','Neighborhoods and towns you cover','One per fact. Naming them is what makes local content work.',true,true,2020),
('price_bands','listings','Typical price range',null,false,false,2030),
('buyer_process','listings','How working with a buyer runs',null,false,false,2040),
('seller_process','listings','How a listing runs, start to close',null,false,false,2050),
('recent_sales','listings','Recent sales worth mentioning','One per fact, no addresses you do not have permission to use.',false,true,2060),
('license_number','re_license','License number',null,true,false,2110),
('brokerage','re_license','Brokerage',null,true,false,2120),
('designations','re_license','Designations','ABR, CRS, GRI and the like.',false,true,2130),
('makes_carried','inventory','Makes you carry',null,true,true,2210),
('new_or_used','inventory','New, used or both',null,true,false,2220),
('inventory_size','inventory','Rough inventory size',null,false,false,2230),
('popular_models','inventory','What actually moves','One per fact.',false,true,2240),
('warranty_terms','inventory','Warranty terms',null,false,false,2250),
('financing_options','financing','Financing you offer',null,true,true,2310),
('trade_in','financing','Trade in policy',null,false,false,2320),
('credit_help','financing','Help for weaker credit',null,false,false,2330),
('service_offered','service_dept','Servicing you do','One per fact.',false,true,2410),
('service_hours','service_dept','Service department hours',null,false,false,2420),
('loaner_policy','service_dept','Loaner or courtesy car policy',null,false,false,2430),
('emergency_callouts','emergency','Do you take emergency callouts',null,true,false,2510),
('response_time','emergency','Typical response time','The single most asked question in the trades.',true,false,2520),
('after_hours_pricing','emergency','Out of hours pricing',null,false,false,2530),
('trade_licenses','licensing','Trade licenses held',null,true,true,2610),
('insurance','licensing','Insurance carried',null,false,false,2620),
('bonded','licensing','Bonded',null,false,false,2630),
('project_types','projects','Types of job you take','One per fact.',true,true,2710),
('portfolio_examples','projects','Past jobs worth showing','One per fact. What it was, where, what was hard about it.',false,true,2720),
('permits_handled','projects','Permits you handle',null,false,false,2730),
('menu_highlights','menu','Dishes worth naming','One per fact.',true,true,2810),
('dietary_options','menu','Dietary options','Vegetarian, vegan, gluten free, halal, kosher.',true,true,2820),
('price_point','menu','Price point',null,false,false,2830),
('drinks','menu','Drinks worth naming',null,false,true,2840),
('reservation_policy','reservations','Reservation policy',null,true,false,2910),
('private_events','reservations','Private hire and events',null,false,false,2920),
('catering','reservations','Catering',null,false,false,2930),
('product_categories','catalog','Product categories','One per fact.',true,true,3010),
('brands_carried','catalog','Brands you carry',null,false,true,3020),
('bestsellers','catalog','Bestsellers',null,false,true,3030),
('shipping_terms','shipping','Shipping terms',null,true,false,3110),
('returns_policy','shipping','Returns policy',null,true,false,3120),
('order_lead_time','shipping','Order lead time',null,false,false,3130),
('practice_list','practice_areas','Practice areas','One per fact.',true,true,3210),
('matter_types','practice_areas','Typical matters or engagements',null,false,true,3220),
('fee_structure','practice_areas','Fee structure','Hourly, fixed fee, retainer, contingency.',true,false,3230),
('treatments','clinical','Treatments offered','One per fact.',true,true,3310),
('insurance_accepted','clinical','Insurance accepted',null,true,true,3320),
('new_patient_process','clinical','How a new patient gets started',null,false,false,3330),
('class_types','classes','Class types','One per fact.',true,true,3410),
('membership_tiers','classes','Membership tiers','One per fact, with the price.',true,true,3420),
('trial_offer','classes','Trial or intro offer',null,false,false,3430),
('salon_service_list','salon_services','Services offered','One per fact, with the price where you can.',true,true,3510),
('booking_lead_time','salon_services','How far ahead people book',null,false,false,3520)
on conflict (key) do nothing;
