-- QuickBite production Supabase schema
-- Run this whole file in Supabase SQL Editor.
-- Frontend must NEVER contain a service_role key.

create extension if not exists pgcrypto;

-- =========================
-- ENUMS
-- =========================
do $$ begin
  create type public.app_role as enum ('user','restaurant','rider','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('pending','confirmed','preparing','ready_for_pickup','picked_up','delivered','cancelled');
exception when duplicate_object then null; end $$;

-- =========================
-- PROFILES / AUTH
-- =========================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'QuickBite User',
  phone text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- =========================
-- RESTAURANTS / MENU
-- =========================
create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  image_url text,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  category text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  image_url text,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_items_restaurant_idx on public.menu_items(restaurant_id);
create index if not exists menu_items_category_idx on public.menu_items(category);

-- =========================
-- CART
-- =========================
create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 99),
  created_at timestamptz not null default now(),
  unique(user_id, menu_item_id)
);

create index if not exists cart_items_user_idx on public.cart_items(user_id);

-- =========================
-- ORDERS
-- =========================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  rider_id uuid references public.profiles(id) on delete set null,
  total_amount numeric(10,2) not null check (total_amount >= 0),
  status public.order_status not null default 'pending',
  delivery_address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists orders_customer_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_restaurant_idx on public.orders(restaurant_id, created_at desc);
create index if not exists orders_rider_idx on public.orders(rider_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items(order_id);

-- =========================
-- SECURITY HELPERS
-- =========================
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

-- =========================
-- ORDER CREATION RPC
-- Keeps price calculation and order creation server-side.
-- =========================
create or replace function public.create_order_from_cart(p_delivery_address text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_restaurant uuid;
  v_restaurant_count integer;
  v_order_id uuid;
  v_order_number text;
  v_total numeric(10,2);
begin
  if v_user is null then raise exception 'You must be logged in'; end if;
  if coalesce(trim(p_delivery_address), '') = '' then raise exception 'Delivery address is required'; end if;

  select count(distinct m.restaurant_id), min(m.restaurant_id)
  into v_restaurant_count, v_restaurant
  from public.cart_items c
  join public.menu_items m on m.id = c.menu_item_id
  where c.user_id = v_user and m.is_available = true;

  if v_restaurant_count = 0 then raise exception 'Your cart is empty'; end if;
  if v_restaurant_count > 1 then raise exception 'Cart can contain items from only one restaurant'; end if;

  select coalesce(sum(m.price * c.quantity), 0)
  into v_total
  from public.cart_items c
  join public.menu_items m on m.id = c.menu_item_id
  where c.user_id = v_user and m.is_available = true;

  v_order_number := 'QB-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders(order_number, customer_id, restaurant_id, total_amount, status, delivery_address)
  values(v_order_number, v_user, v_restaurant, v_total, 'pending', trim(p_delivery_address))
  returning id into v_order_id;

  insert into public.order_items(order_id, menu_item_id, quantity, unit_price)
  select v_order_id, c.menu_item_id, c.quantity, m.price
  from public.cart_items c
  join public.menu_items m on m.id = c.menu_item_id
  where c.user_id = v_user and m.is_available = true;

  delete from public.cart_items where user_id = v_user;
  return v_order_number;
end;
$$;

grant execute on function public.create_order_from_cart(text) to authenticated;

-- =========================
-- RLS
-- =========================
alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.menu_items enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Profiles: Authenticated users can read basic profile info (e.g. customer name on orders, user lists for admins)
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update_self_or_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Restaurant catalog is public; management is protected.
drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants for select to anon, authenticated using (is_open = true or public.is_admin() or owner_id = auth.uid());
drop policy if exists restaurants_owner_admin_insert on public.restaurants;
create policy restaurants_owner_admin_insert on public.restaurants for insert to authenticated with check (public.is_admin());
drop policy if exists restaurants_owner_admin_update on public.restaurants;
create policy restaurants_owner_admin_update on public.restaurants for update to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());

-- Menu items: public read for available items; restaurant owner/admin can manage.
drop policy if exists menu_public_read on public.menu_items;
create policy menu_public_read on public.menu_items for select to anon, authenticated using (is_available = true or public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));
drop policy if exists menu_owner_admin_insert on public.menu_items;
create policy menu_owner_admin_insert on public.menu_items for insert to authenticated with check (public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));
drop policy if exists menu_owner_admin_update on public.menu_items;
create policy menu_owner_admin_update on public.menu_items for update to authenticated using (public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid())) with check (public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));
drop policy if exists menu_owner_admin_delete on public.menu_items;
create policy menu_owner_admin_delete on public.menu_items for delete to authenticated using (public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));

-- Cart belongs to the signed-in customer.
drop policy if exists cart_owner_all on public.cart_items;
create policy cart_owner_all on public.cart_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Orders: customer sees own, restaurant sees its own, assigned rider sees assigned, admin sees all.
drop policy if exists orders_read_roles on public.orders;
create policy orders_read_roles on public.orders for select to authenticated using (
  customer_id = auth.uid() or rider_id = auth.uid() or public.is_admin() or
  exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()) or
  (public.current_app_role()='rider' and status='ready_for_pickup')
);
drop policy if exists orders_restaurant_update on public.orders;
create policy orders_restaurant_update on public.orders for update to authenticated using (
  public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid())
) with check (public.is_admin() or exists(select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));
drop policy if exists orders_rider_update on public.orders;
create policy orders_rider_update on public.orders for update to authenticated using (rider_id = auth.uid()) with check (rider_id = auth.uid());
drop policy if exists orders_customer_cancel on public.orders;
create policy orders_customer_cancel on public.orders for update to authenticated using (customer_id = auth.uid() and status = 'pending') with check (customer_id = auth.uid() and status = 'cancelled');

-- Customer order cancellation RPC
create or replace function public.cancel_customer_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set status = 'cancelled', updated_at = now()
  where id = p_order_id and customer_id = auth.uid() and status = 'pending';
  return found;
end;
$$;
grant execute on function public.cancel_customer_order(uuid) to authenticated;

-- Restaurant claiming RPC for restaurant owners or admins
create or replace function public.claim_restaurant(p_restaurant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() not in ('restaurant', 'admin') then
    raise exception 'Only restaurant partners or admins can claim a restaurant';
  end if;
  update public.restaurants
  set owner_id = auth.uid(), updated_at = now()
  where id = p_restaurant_id and (owner_id is null or public.is_admin());
  return found;
end;
$$;
grant execute on function public.claim_restaurant(uuid) to authenticated;

-- User role management RPC (admin can change roles, or first user can bootstrap admin)
create or replace function public.set_user_role(p_user_id uuid, p_new_role public.app_role)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if not exists(select 1 from public.profiles where role = 'admin') then
      update public.profiles set role = p_new_role, updated_at = now() where id = auth.uid();
      return true;
    else
      raise exception 'Only administrators can change user roles';
    end if;
  end if;
  update public.profiles set role = p_new_role, updated_at = now() where id = p_user_id;
  return found;
end;
$$;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

-- Rider claiming is a server-side atomic operation so two riders cannot claim the same order.
create or replace function public.claim_delivery_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'rider' and not public.is_admin() then raise exception 'Only riders can claim deliveries'; end if;
  update public.orders
  set rider_id = auth.uid(), status = 'picked_up', updated_at = now()
  where id = p_order_id and status = 'ready_for_pickup' and rider_id is null;
  return found;
end;
$$;

grant execute on function public.claim_delivery_order(uuid) to authenticated;

-- Order items follow order visibility.
drop policy if exists order_items_read_roles on public.order_items;
create policy order_items_read_roles on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and (o.customer_id=auth.uid() or o.rider_id=auth.uid() or public.is_admin() or exists(select 1 from public.restaurants r where r.id=o.restaurant_id and r.owner_id=auth.uid()))));

-- =========================
-- UPDATED_AT TRIGGER
-- =========================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists restaurants_updated_at on public.restaurants;
create trigger restaurants_updated_at before update on public.restaurants for each row execute procedure public.set_updated_at();
drop trigger if exists menu_items_updated_at on public.menu_items;
create trigger menu_items_updated_at before update on public.menu_items for each row execute procedure public.set_updated_at();
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders for each row execute procedure public.set_updated_at();

-- =========================
-- REALTIME
-- =========================
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.menu_items;
exception when duplicate_object then null; end $$;

-- =========================
-- SEED RESTAURANTS
-- Existing 24-item demo menu from the supplied project.
-- =========================
insert into public.restaurants(name, slug, description) values
('Pakwan','pakwan','Indian food'),
('Food Villa','food-villa','Multi-cuisine restaurant'),
('Zannat Mandi','zannat-mandi','Mandi restaurant'),
('FFC','ffc','Cafe and shakes'),
('Green chilly','green-chilly','Restaurant'),
('Mirch Masala','mirch-masala','Indian and Chinese'),
('Pakwan primium','pakwan-primium','Premium Indian food'),
('GPS','gps','Restaurant'),
('Rikas Cafee','rikas-cafee','Cafe'),
('Sweet Delights','sweet-delights','Desserts'),
('Royal Biryani House','royal-biryani-house','Biryani restaurant'),
('The Tandoori Trail','the-tandoori-trail','Tandoori restaurant'),
('Pizzaria Gusto','pizzaria-gusto','Pizza and pasta'),
('Chinatown Express','chinatown-express','Chinese cuisine'),
('Roll Nation','roll-nation','Rolls and snacks'),
('Burger Street','burger-street','Burgers and fries'),
('Cafe Brew Hub','cafe-brew-hub','Cafe and beverages')
on conflict(slug) do nothing;

-- Menu seed. Re-running is safe because each row is identified by restaurant + name.
insert into public.menu_items(restaurant_id,name,category,description,price,image_url)
select r.id, v.name, v.category, v.description, v.price, v.image_url
from (values
('Pakwan','chicken Dum Biryani','Rolls & Snacks','Grilled spiced paneer cubes wrapped in fresh whole-wheat flatbread with mint mayo and pickled onions',149,'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=600&auto=format&fit=crop&q=80'),
('Food Villa','Veg Meal','Pizzas','Crust stuffed with hot melting mozzarella, loaded with garden-fresh bell peppers, sweet corn, and Italian herbs',299,'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80'),
('Zannat Mandi','Veg & non-veg Mandi','Biryani & Meals','Slow dum cooked long-grain basmati rice with royal Indian herbs, saffron broth, and crispy golden onions',240,'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80'),
('FFC','pizza caramel shake','Brews & Shakes','Double shot roasted espresso blended with smooth ice cream, cold milk, and thick buttery caramel drizzle',130,'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=600&auto=format&fit=crop&q=80'),
('Green chilly','Tandoori','Desserts','Warm European cocoa cake with a hot, oozing Belgian chocolate core that melts in your mouth',119,'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&auto=format&fit=crop&q=80'),
('Mirch Masala','Fried rice & Veg Manchurian','Rolls & Snacks','Crunchy crumbed spice patty stacked with iceberg lettuce, pickled gherkins, and house spicy garlic mayo',169,'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80'),
('Pakwan primium','Dal Makhani with Garlic Naan','Biryani & Meals','Slow-simmered black lentils cooked overnight on charcoal with butter and cream, served with crisp butter naan',219,'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80'),
('GPS','CHicken curry with Butter Naan','Pizzas','Thin crust loaded with black olives, button mushrooms, capsicum, red paprika, and creamy cheddar',279,'https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?w=600&auto=format&fit=crop&q=80'),
('Rikas Cafee','brownies with ice cream','Desserts','Rich red velvet sponge crumbled over vanilla bean gelato, topped with white chocolate flakes and strawberry puree',149,'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=600&auto=format&fit=crop&q=80'),
('Sweet Delights','Alfonso Mango Thickshake','Brews & Shakes','Pure Ratnagiri alfonso pulp blended with rich condensed milk and topped with fresh mango chunks',159,'https://images.unsplash.com/photo-1546173159-315724a31696?w=600&auto=format&fit=crop&q=80'),
('Royal Biryani House','Hyderabadi Chicken Dum Biryani','Biryani & Meals','Tender chicken marinated in browned onions, mint, and spices, layered with aromatic basmati rice',320,'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600&auto=format&fit=crop&q=80'),
('The Tandoori Trail','Butter Chicken with Roomali','Biryani & Meals','Charcoal grilled chicken cooked in a rich satin-smooth tomato and cashew nut gravy enriched with butter',349,'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&auto=format&fit=crop&q=80'),
('Pizzaria Gusto','Cheesy Garlic Breadsticks','Rolls & Snacks','Freshly baked herb breadsticks brushed with infused garlic butter and filled with melted mozzarella',139,'https://images.unsplash.com/photo-1619535860434-ba1d8fa12536?w=600&auto=format&fit=crop&q=80'),
('Chinatown Express','Steamed Veg Himalayan Momos','Rolls & Snacks','Delicate dumplings stuffed with minced vegetables, paneer, and scallions, served with spicy red chili dip',120,'https://imgs.search.brave.com/zvtWkc6u4fHYqpXDP_4qeEzz5hRurEV-hYV75Hb0D3Y/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly90aHVt/YnMuZHJlYW1zdGlt/ZS5jb20vYi92ZWctbW9tb3Mtc3RlYW1l/ZC10YW1hdG8tY2hp/bGxpLXNhdWNlLWlu/ZGlhbi1tb21vLTI5/ODUxMTk4OC5qcGc'),
('Chinatown Express','Hakka Noodles with Manchurian','Biryani & Meals','Wok-tossed noodles with crunchy bell peppers, cabbage, and soy sauce, served with vegetable Manchurian balls',199,'https://images.unsplash.com/photo-1585032226651-759b368d7246?w=600&auto=format&fit=crop&q=80'),
('Pizzaria Gusto','Creamy Alfredo White Sauce Pasta','Biryani & Meals','Penne tossed in a velvety parmesan and garlic cream sauce with fresh broccoli, zucchini, and mushrooms',249,'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?w=600&auto=format&fit=crop&q=80'),
('Pizzaria Gusto','Fiery Paneer & Jalapeno Pizza','Pizzas','Spicy tandoori paneer slices, tangy Mexican jalapenos, golden corn, and extra mozzarella cheese',319,'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=600&auto=format&fit=crop&q=80'),
('Roll Nation','Chicken Kathi Roll','Rolls & Snacks','Flaky paratha coated with an egg layer, rolled with juicy chicken tikka, sliced onions, and lemon zest',179,'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&auto=format&fit=crop&q=80'),
('Burger Street','Loaded Cheesy French Fries','Rolls & Snacks','Crispy skin-on potato fries smothered with melted cheese sauce, salsa drizzle, and chili seasoning',129,'https://imgs.search.brave.com/eSkQNN54P4A8QLSOu0slYSdFntGhtFhN6tQYDQm5I98/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9ob3Vz/ZW9meXVtbS5jb20v/d3AtY29udGVudC91/cGxvYWRzLzIwMjQvMDkvbG9hZGVkLWZyZW5jaC1mcmllcy0yLTEyMDB4ODAwLmpwZw'),
('Sweet Delights','Warm Sizzling Walnut Brownie','Desserts','Dense dark chocolate fudge brownie with toasted walnuts, topped with chocolate sauce',139,'https://images.unsplash.com/photo-1607920591413-4ec007e70023?w=600&auto=format&fit=crop&q=80'),
('Sweet Delights','New York Baked Cheesecake','Desserts','Classic buttery graham cracker base filled with dense, creamy cream cheese and blueberry compote',189,'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=600&auto=format&fit=crop&q=80'),
('Cafe Brew Hub','Fresh Mint Mojito','Brews & Shakes','Refreshing cooler made with crushed garden mint leaves, lime wedges, simple syrup, and bubbly soda',110,'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=600&auto=format&fit=crop&q=80'),
('Cafe Brew Hub','Belgian Chocolate Oreo Shake','Brews & Shakes','Crushed Oreo cookies blended with chocolate ice cream, rich whole milk, and topped with chocolate curls',149,'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=600&auto=format&fit=crop&q=80'),
('Roll Nation','Crispy Corn & Cheese Tacos','Rolls & Snacks','Hard shell corn tortillas loaded with sweet corn, shredded cabbage, cheddar cheese, and sour cream',159,'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&auto=format&fit=crop&q=80')
) as v(restaurant,name,category,description,price,image_url)
join public.restaurants r on r.name=v.restaurant
where not exists(select 1 from public.menu_items m where m.restaurant_id=r.id and m.name=v.name);

-- =========================
-- FIRST ADMIN / STAFF SETUP
-- =========================
-- 1) Create a normal account from the website.
-- 2) Copy its auth.users.id from Supabase Dashboard.
-- 3) Run one of these statements manually as the project owner:
-- update public.profiles set role='admin' where id='YOUR_AUTH_USER_UUID';
-- update public.profiles set role='restaurant' where id='YOUR_AUTH_USER_UUID';
-- update public.profiles set role='rider' where id='YOUR_AUTH_USER_UUID';
-- 4) For a restaurant account, also run:
-- update public.restaurants set owner_id='YOUR_AUTH_USER_UUID' where slug='pakwan';
--
-- Do not expose service_role credentials in config.js.
