-- Areas the app groups homes into. Extend as feeds cover more of Sweden.
insert into areas (id, name, city, lat, lng) values
  ('sodermalm', 'Södermalm', 'Stockholm', 59.3142, 18.0716),
  ('vasastan', 'Vasastan', 'Stockholm', 59.3435, 18.0445),
  ('ostermalm', 'Östermalm', 'Stockholm', 59.3378, 18.0835),
  ('kungsholmen', 'Kungsholmen', 'Stockholm', 59.3318, 18.0300),
  ('gamlastan', 'Gamla stan', 'Stockholm', 59.3251, 18.0711),
  ('hammarby', 'Hammarby Sjöstad', 'Stockholm', 59.3035, 18.0985),
  ('liljeholmen', 'Liljeholmen', 'Stockholm', 59.3100, 18.0230),
  ('arsta', 'Årsta', 'Stockholm', 59.2985, 18.0500),
  ('gardet', 'Gärdet', 'Stockholm', 59.3460, 18.1000),
  ('solna', 'Solna', 'Solna', 59.3640, 18.0000),
  ('bromma', 'Bromma', 'Stockholm', 59.3370, 17.9400),
  ('nacka', 'Nacka', 'Nacka', 59.3105, 18.1640)
on conflict (id) do nothing;
