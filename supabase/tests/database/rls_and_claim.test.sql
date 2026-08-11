begin;

select plan(20);

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
      '{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","displayName":"One updated","country":"VN","language":"vi","currency":"VND","timezone":"Asia/Saigon","createdAt":"2026-08-12T00:00:00.000Z"}'::jsonb
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
select is(
  (
    select entity_id::text || ':' || (payload->>'remoteRevision')
    from public.sync_changes
    where user_id = auth.uid() and entity_type = 'preferences'
    order by cursor desc
    limit 1
  ),
  '11111111-1111-4111-8111-111111111111:1',
  'preference change feed uses the cloud subject and carries its remote revision'
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

select * from finish();
rollback;
