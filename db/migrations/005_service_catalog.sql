-- Studio-managed packages and a la carte catalog.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS package_snapshot JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS addon_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS service_catalog (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('package','addon')),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  includes JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_catalog_kind_sort_idx ON service_catalog(kind, active DESC, sort_order, name);
INSERT INTO service_catalog (id,kind,name,tagline,includes,price_cents,featured,sort_order) VALUES
('essential','package','Essential Photography','Interior + exterior stills, MLS-ready','["Up to 25 edited photos","Interior and exterior coverage","Blue-sky sky replacement","Next-business-day delivery"]',17500,false,10),
('premium','package','Premium Photo + Drone','Stills plus aerial coverage','["Up to 40 edited photos","FAA-compliant drone aerials","Interior, exterior, and neighborhood context","Next-business-day delivery"]',27500,true,20),
('full-media','package','Full Media Package','Photos, drone, video, 3D tour, and floor plan','["Everything in Premium","Video walkthrough (60-90s)","Social-media vertical cut","3D tour (Matterport or Zillow 3D)","2D floor plan"]',45000,false,30),
('twilight','addon','Twilight shoot','','[]',12500,false,10),
('drone-extra','addon','Additional drone coverage','','[]',7500,false,20),
('floorplan','addon','2D floor plan','','[]',5000,false,30),
('video','addon','Video walkthrough','','[]',15000,false,40),
('social-cut','addon','Social-media vertical cut','','[]',7500,false,50),
('tour-3d','addon','3D tour (Matterport or Zillow 3D)','','[]',15000,false,60),
('rush','addon','Same-day rush delivery','','[]',10000,false,70)
ON CONFLICT (id) DO NOTHING;
