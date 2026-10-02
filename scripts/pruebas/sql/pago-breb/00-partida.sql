-- Ayudantes de las pruebas SQL del pago con Bre-B (migración 20261003150000_pago_breb.sql).
-- Se corre DESPUÉS de sql/cola-impresion/00-ayudantes.sql (las identidades de prueba .test, t.ok, t.como, t.falla…) y de la cadena
-- completa de migraciones. Nada de aquí es un dato real: los vectores (QR y llaves ficticios) los inserta la prueba de Node.

-- Los vectores que llena la prueba de Node (con una implementación del CRC distinta de la que se prueba).
create table if not exists t.qr_malos (n serial primary key, nombre text not null, valor text not null, restriccion text not null);
create table if not exists t.llaves_buenas (n serial primary key, valor text not null);
create table if not exists t.llaves_malas (n serial primary key, nombre text not null, valor text not null);
grant all on t.qr_malos, t.llaves_buenas, t.llaves_malas to public;
grant usage on sequence t.qr_malos_n_seq, t.llaves_buenas_n_seq, t.llaves_malas_n_seq to public;

-- Datos de partida (como dueño): el personal de siempre y los ajustes del pago apagados y vacíos.
-- admin y admin2, mesero1 y mesero2 aprobados; eliminado dado de baja; pendiente con su fila pendiente; ajena y correo sin fila.
create or replace function t.partida_pago() returns void language plpgsql as
$$
begin
  perform t.fuera();
  delete from public.personal where email <> 'admin@resplandor.test';
  update public.personal set activo = true, rol = 'admin', estado = 'aprobado' where email = 'admin@resplandor.test';
  insert into public.personal (email, nombre, rol, activo, estado) values
    ('admin2@resplandor.test',    'Admin Dos',  'admin',  true,  'aprobado'),
    ('mesero1@resplandor.test',   'Mesero Uno', 'mesero', true,  'aprobado'),
    ('mesero2@resplandor.test',   'Mesero Dos', 'mesero', true,  'aprobado'),
    ('eliminado@resplandor.test', 'Eliminado',  'mesero', false, 'aprobado'),
    ('pendiente@resplandor.test', 'Pendiente',  'mesero', true,  'pendiente');
  update public.ajustes
     set pago_breb_visible = false, pago_breb_llave = null, pago_breb_qr = null,
         ticket_pie = 'Gracias por su visita', ticket_qr_url = 'https://resplandor.ynt.codes/'
   where id = 1;
end $$;

-- Cambia (como la persona indicada, con el rol de la API) la llave de ajustes: true si la base la aceptó, false si un CHECK la rechazó.
create or replace function t.llave_acepta(p_quien text, p_llave text) returns boolean language plpgsql as
$$
declare n integer;
begin
  perform t.como(p_quien);
  begin
    update public.ajustes set pago_breb_llave = p_llave where id = 1;
    get diagnostics n = row_count;
    perform t.fuera();
    if n <> 1 then raise exception 'la fila de ajustes no se actualizó (% filas): la prueba no probó nada', n; end if;
    return true;
  exception when check_violation then
    perform t.fuera();
    return false;
  end;
end $$;

-- Lo mismo con el contenido del QR: devuelve el nombre del CHECK que lo rechazó, o 'ok'.
create or replace function t.qr_resultado(p_quien text, p_qr text) returns text language plpgsql as
$$
declare v_c text; n integer;
begin
  perform t.como(p_quien);
  begin
    update public.ajustes set pago_breb_qr = p_qr where id = 1;
    get diagnostics n = row_count;
    perform t.fuera();
    if n <> 1 then raise exception 'la fila de ajustes no se actualizó (% filas): la prueba no probó nada', n; end if;
    return 'ok';
  exception when check_violation then
    get stacked diagnostics v_c = constraint_name;
    perform t.fuera();
    return v_c;
  end;
end $$;

-- Entra con la llave de servicio (el rol de las Edge Functions): `service_role`, con sus claims de PostgREST.
create or replace function t.como_servicio() returns void language plpgsql as
$$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  execute 'set role service_role';
end $$;

grant execute on all functions in schema t to public;
