begin;

select plan(44);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-one@timefarm.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-two@timefarm.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (
  id,
  workspace_id,
  display_name,
  country,
  language,
  currency,
  timezone
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'rls-owner-one',
    'Owner one',
    'VN',
    'vi',
    'VND',
    'Asia/Saigon'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'rls-owner-two',
    'Owner two',
    'US',
    'en',
    'USD',
    'UTC'
  );

-- Production clients use the security-definer RPC boundary, so direct table
-- privileges stay closed by default. Grant the minimum read surface only
-- inside this rolled-back test transaction to exercise the owner RLS policies
-- and inspect canonical RPC results as the authenticated role.
grant select on table
  public.profiles,
  public.projects
to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'RLS reveals only the authenticated owner profile'
);
select is(
  (select id::text from public.profiles limit 1),
  '11111111-1111-4111-8111-111111111111',
  'RLS never leaks the other profile'
);

reset role;
delete from public.profiles;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (
    public.workly_claim_workspace(
      'atomic-workspace',
      '{"displayName":"One","country":"VN","language":"vi","currency":"VND","timezone":"Asia/Saigon"}'::jsonb
    )->>'claimed'
  )::boolean,
  true,
  'the first authenticated user atomically claims a workspace'
);
select is(
  (
    public.workly_claim_workspace(
      'different-workspace',
      '{"displayName":"One","country":"VN","language":"vi","currency":"VND","timezone":"Asia/Saigon"}'::jsonb
    )->>'claimed'
  )::boolean,
  false,
  'one cloud profile cannot switch to another local workspace'
);
select lives_ok(
  $$
    select public.workly_apply_sync_operation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'account',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","displayName":"One updated","country":"VN","language":"vi","currency":"VND","timezone":"Asia/Saigon","createdAt":"2026-08-12T00:00:00.000Z"}'::jsonb,
      0
    )
  $$,
  'account sync remains compatible after a workspace claim'
);
select is(
  (select workspace_id from public.profiles where id = auth.uid()),
  'atomic-workspace',
  'account sync cannot replace the server-owned workspace claim'
);
select lives_ok(
  $$
    select public.workly_apply_sync_operation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
      'preferences',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      '{"theme":"dark","miniTimerMode":"hidden","dashboardHiddenWidgets":[],"dashboardWidgetOrder":[],"dashboardWidgetSizes":{}}'::jsonb,
      0
    )
  $$,
  'preference CAS accepts the local workspace id as its request identity'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
      'project',
      '10000000-0000-4000-8000-000000000099',
      'upsert',
      '{"id":"10000000-0000-4000-8000-000000000099"}'::jsonb,
      null
    )
  $$,
  '22023',
  'Expected revision must be a non-negative safe integer',
  'the public writer rejects an explicit NULL CAS revision'
);
select lives_ok(
  $$
    select * from public.workly_pull_changes(0, 100)
  $$,
  'authenticated clients can pull changes through the RPC boundary'
);
select throws_ok(
  $$
    select * from public.workly_pull_changes(0, null)
  $$,
  '22023',
  'Pull limit must be a positive integer',
  'change-feed pulls cannot bypass the page bound with a null limit'
);
select is(
  (
    select entity_id::text || ':' || (payload->>'remoteRevision')
    from public.workly_pull_changes(0, 100)
    where entity_type = 'preferences'
    order by cursor desc
    limit 1
  ),
  '11111111-1111-4111-8111-111111111111:1',
  'preference change feed uses the cloud subject and carries its remote revision'
);
select throws_ok(
  $$
    select count(*) from public.sync_changes
  $$,
  '42501',
  'permission denied for table sync_changes',
  'authenticated clients cannot read the change-feed table directly'
);

reset role;
insert into public.projects (
  id,
  user_id,
  name,
  payment_model,
  color,
  icon,
  status,
  created_at,
  updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Bootstrap page one',
    'per_session',
    '#625bf6',
    'briefcase',
    'active',
    '2026-08-12T00:00:00Z',
    '2026-08-12T00:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Bootstrap page two',
    'per_session',
    '#45d6c3',
    'briefcase',
    'active',
    '2026-08-12T00:00:01Z',
    '2026-08-12T00:00:01Z'
  );
set local role authenticated;

select is(
  jsonb_array_length(public.workly_bootstrap_page(null, null, null, 1)->'items'),
  1,
  'bootstrap returns no more than the requested page size'
);
select is(
  (public.workly_bootstrap_page(null, null, null, 1)->>'hasMore')::boolean,
  true,
  'bootstrap reports a lookahead row without embedding it in the page'
);
select is(
  public.workly_bootstrap_page(
    'project',
    '10000000-0000-4000-8000-000000000001',
    (public.workly_bootstrap_page(null, null, null, 1)->>'cursor')::bigint,
    1
  )#>>'{items,0,entityId}',
  '20000000-0000-4000-8000-000000000002',
  'bootstrap cursor advances to the next canonical entity'
);
select is(
  (
    public.workly_bootstrap_page(
      'project',
      '10000000-0000-4000-8000-000000000001',
      (public.workly_bootstrap_page(null, null, null, 1)->>'cursor')::bigint,
      1
    )->>'hasMore'
  )::boolean,
  false,
  'the final bootstrap page terminates pagination'
);
select throws_ok(
  $$
    select public.workly_bootstrap_page(null, null, null, null)
  $$,
  '22023',
  'Bootstrap page size must be between 1 and 500',
  'base bootstrap cannot interpret a NULL limit as unbounded'
);
select throws_ok(
  $$
    select public.workly_bootstrap_page_v2(null, null, null, null)
  $$,
  '22023',
  'Bootstrap page size must be between 1 and 500',
  'revision-aware bootstrap inherits the strict page bound'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000090',
      'project',
      '10000000-0000-4000-8000-000000000090',
      'upsert',
      jsonb_build_object(
        'id', '10000000-0000-4000-8000-000000000090',
        'name', repeat('x', 161),
        'paymentModel', 'per_session',
        'expectedMoney', null,
        'note', null,
        'color', '#625bf6',
        'icon', 'briefcase',
        'status', 'active',
        'completedAt', null,
        'createdAt', '2026-08-12T00:00:00Z',
        'updatedAt', '2026-08-12T00:00:00Z'
      ),
      0
    )
  $$,
  '22023',
  'Project name must contain 1 to 160 characters',
  'cloud project validation matches the desktop text bound'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000093',
      'account',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","displayName":"One","country":"V1","language":"vi","currency":"VND","timezone":"Asia/Saigon","createdAt":"2026-08-12T00:00:00.000Z"}'::jsonb,
      1
    )
  $$,
  '22023',
  'Account country must be a two- or three-letter code',
  'cloud account validation rejects non-letter country codes'
);
select lives_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000095',
      'account',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      jsonb_build_object(
        'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'displayName', repeat('😀', 100),
        'country', 'VN',
        'language', 'vi',
        'currency', 'VND',
        'timezone', 'Asia/Saigon',
        'createdAt', '2026-08-12T00:00:00.000Z'
      ),
      1
    )
  $$,
  'cloud and desktop both count supplementary Unicode by code point'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000096',
      'account',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      jsonb_build_object(
        'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'displayName', repeat('😀', 101),
        'country', 'VN',
        'language', 'vi',
        'currency', 'VND',
        'timezone', 'Asia/Saigon',
        'createdAt', '2026-08-12T00:00:00.000Z'
      ),
      2
    )
  $$,
  '22023',
  'Account display name must contain 1 to 100 characters',
  'cloud and desktop reject the same Unicode code-point overflow'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000097',
      'account',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      jsonb_build_object(
        'id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'displayName', chr(160),
        'country', 'VN',
        'language', 'vi',
        'currency', 'VND',
        'timezone', 'Asia/Saigon',
        'createdAt', '2026-08-12T00:00:00.000Z'
      ),
      2
    )
  $$,
  '22023',
  'Account display name must contain 1 to 100 characters',
  'cloud and ECMAScript trim both reject an NBSP-only display name'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000094',
      'goal',
      '60000000-0000-4000-8000-000000000094',
      'upsert',
      '{"id":"60000000-0000-4000-8000-000000000094","kind":"earnings_monthly","target":1.5,"createdAt":"2026-08-12T00:00:00.000Z"}'::jsonb,
      0
    )
  $$,
  '22023',
  'Earnings and completed-project goals require whole-unit targets',
  'cloud earnings goals use whole minor currency units like the desktop'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000091',
      'payment',
      '50000000-0000-4000-8000-000000000091',
      'upsert',
      '{"id":"50000000-0000-4000-8000-000000000091","projectId":"10000000-0000-4000-8000-000000000001","money":{"amountMinor":9007199254740992,"currency":"VND"},"receivedAt":"2026-08-12T00:00:00Z","kind":"progressive","note":null,"createdAt":"2026-08-12T00:00:00Z"}'::jsonb,
      0
    )
  $$,
  '22023',
  'Payment amount must be a non-negative safe integer',
  'cloud money cannot exceed the JavaScript safe-integer range'
);
select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000092',
      'preferences',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'upsert',
      '{"theme":"dark","miniTimerMode":"hidden","dashboardHiddenWidgets":["timer","timer"],"dashboardWidgetOrder":[],"dashboardWidgetSizes":{}}'::jsonb,
      1
    )
  $$,
  '22023',
  'Dashboard hidden widgets are invalid',
  'cloud preferences reject duplicate widgets like the local normalizer'
);

select is(
  (
    public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000001',
      'project',
      '10000000-0000-4000-8000-000000000001',
      'upsert',
      '{"id":"10000000-0000-4000-8000-000000000001","name":"CAS winner","paymentModel":"per_session","expectedMoney":null,"note":null,"color":"#625bf6","icon":"briefcase","status":"active","completedAt":null,"createdAt":"2026-08-12T00:00:00Z","updatedAt":"2026-08-12T00:01:00Z"}'::jsonb,
      0
    )->>'remoteRevision'
  )::bigint,
  1::bigint,
  'a current expected revision advances the entity version'
);
select is(
  (
    public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000002',
      'project',
      '10000000-0000-4000-8000-000000000001',
      'upsert',
      '{"id":"10000000-0000-4000-8000-000000000001","name":"Stale loser","paymentModel":"per_session","expectedMoney":null,"note":null,"color":"#625bf6","icon":"briefcase","status":"active","completedAt":null,"createdAt":"2026-08-12T00:00:00Z","updatedAt":"2026-08-12T00:02:00Z"}'::jsonb,
      0
    )->>'conflict'
  )::boolean,
  true,
  'a stale expected revision is rejected without applying the write'
);
select is(
  (select name from public.projects where id = '10000000-0000-4000-8000-000000000001'),
  'CAS winner',
  'a rejected stale write cannot overwrite the winner'
);
select is(
  (
    public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000003',
      'project',
      '10000000-0000-4000-8000-000000000001',
      'upsert',
      '{"id":"10000000-0000-4000-8000-000000000001","name":"CAS retry","paymentModel":"per_session","expectedMoney":null,"note":null,"color":"#625bf6","icon":"briefcase","status":"active","completedAt":null,"createdAt":"2026-08-12T00:00:00Z","updatedAt":"2026-08-12T00:03:00Z"}'::jsonb,
      1
    )->>'remoteRevision'
  )::bigint,
  2::bigint,
  'an explicit retry from the observed winner revision succeeds'
);
select is(
  (select name from public.projects where id = '10000000-0000-4000-8000-000000000001'),
  'CAS retry',
  'the successful revision-aware retry becomes canonical'
);

reset role;
insert into public.work_sessions (
  id,
  user_id,
  project_id,
  started_at,
  ended_at,
  timezone,
  active_duration_ms,
  status,
  earnings_amount_minor,
  earnings_currency
) values (
  '40000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000001',
  '2026-08-12T01:00:00Z',
  '2026-08-12T02:00:00Z',
  'UTC',
  3600000,
  'completed',
  0,
  'VND'
);
insert into public.payments (
  id,
  user_id,
  project_id,
  amount_minor,
  currency,
  received_at,
  kind
) values (
  '50000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-000000000001',
  100000,
  'VND',
  '2026-08-12T02:00:00Z',
  'progressive'
);
set local role authenticated;

select throws_ok(
  $$
    select public.workly_apply_sync_operation(
      '30000000-0000-4000-8000-000000000004',
      'project',
      '10000000-0000-4000-8000-000000000001',
      'delete',
      '{"id":"10000000-0000-4000-8000-000000000001"}'::jsonb,
      2
    )
  $$,
  'P0001',
  'Projects with work or payment history cannot be deleted',
  'project deletion rejects durable session and payment history'
);

reset role;
select ok(
  exists (
    select 1
    from public.projects
    where id = '10000000-0000-4000-8000-000000000001'
  ),
  'a rejected project deletion preserves the project'
);
select is(
  (
    select project_id::text
    from public.work_sessions
    where id = '40000000-0000-4000-8000-000000000001'
  ),
  '10000000-0000-4000-8000-000000000001',
  'a rejected project deletion preserves session attribution'
);
select is(
  (
    select project_id::text
    from public.payments
    where id = '50000000-0000-4000-8000-000000000001'
  ),
  '10000000-0000-4000-8000-000000000001',
  'a rejected project deletion preserves payment history'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (
    public.workly_claim_workspace(
      'atomic-workspace',
      '{"displayName":"Two","country":"US","language":"en","currency":"USD","timezone":"UTC"}'::jsonb
    )->>'claimed'
  )::boolean,
  false,
  'a second authenticated user cannot claim an owned workspace'
);
select is(
  (
    public.workly_claim_workspace(
      'second-workspace',
      '{"displayName":"Two","country":"US","language":"en","currency":"USD","timezone":"UTC"}'::jsonb
    )->>'claimed'
  )::boolean,
  true,
  'the second authenticated user can claim a distinct workspace'
);
select throws_ok(
  $$
    select public.workly_claim_workspace(
      'bad-currency',
      '{"displayName":"Two","country":"US","language":"en","currency":"AUD","timezone":"UTC"}'::jsonb
    )
  $$,
  'P0001',
  'Unsupported profile currency',
  'workspace claim rejects currencies outside the desktop contract'
);
select throws_ok(
  $$
    select public.workly_claim_workspace(
      'blank-display-name',
      '{"displayName":"   ","country":"US","language":"en","currency":"USD","timezone":"UTC"}'::jsonb
    )
  $$,
  '22023',
  'Profile display name must contain 1 to 100 characters',
  'workspace claim rejects a profile the local normalizer cannot persist'
);

reset role;
with inserted as (
  insert into public.sync_changes (
    user_id,
    entity_type,
    entity_id,
    operation,
    payload,
    created_at
  ) values (
    '22222222-2222-4222-8222-222222222222',
    'goal',
    '60000000-0000-4000-8000-000000000001',
    'delete',
    '{"id":"60000000-0000-4000-8000-000000000001","remoteRevision":2}'::jsonb,
    now() - interval '120 days'
  )
  returning cursor
)
select set_config(
  'timefarm.test_retention_cursor',
  inserted.cursor::text,
  true
)
from inserted;
set local role service_role;
select throws_ok(
  format(
    $$
      select public.workly_prune_sync_changes(
        '22222222-2222-4222-8222-222222222222',
        %s,
        now() - interval '1 day'
      )
    $$,
    current_setting('timefarm.test_retention_cursor')
  ),
  '22023',
  'Retention cutoff must be at least 90 days old',
  'retention cannot discard a recently delivered offline window'
);
select is(
  (
    public.workly_prune_sync_changes(
      '22222222-2222-4222-8222-222222222222',
      current_setting('timefarm.test_retention_cursor')::bigint,
      now() - interval '100 days'
    )->>'deletedRows'
  )::bigint,
  1::bigint,
  'trusted retention deletes only rows satisfying both safe cutoffs'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;
select is(
  (
    public.workly_bootstrap_page_v2(null, null, null, 1)->>'cursor'
  )::bigint,
  current_setting('timefarm.test_retention_cursor')::bigint,
  'a full bootstrap starts at least at the durable retention watermark'
);
select throws_ok(
  $$
    select * from public.workly_pull_changes(0, 100)
  $$,
  'P0001',
  'Change cursor expired; full bootstrap required',
  'a stale device is told to rebuild instead of receiving a partial feed'
);
select lives_ok(
  format(
    'select * from public.workly_pull_changes(%s, 100)',
    current_setting('timefarm.test_retention_cursor')
  ),
  'a device at the durable retention watermark can continue pulling'
);

select * from finish();
rollback;
