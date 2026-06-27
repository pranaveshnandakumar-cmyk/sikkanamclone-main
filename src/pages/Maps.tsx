import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import SikkanamMap from "@/components/SikkanamMap";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { tnDestinations } from "@/data/tnDestinations";
import {
  MapPin,
  Navigation,
  ArrowUpDown,
  Clock,
  Route as RouteIcon,
  Crosshair,
  Bus,
  Train,
  Car,
  X,
  AlertCircle
} from "lucide-react";

interface LocationInfo {
  name: string;
  lat: number;
  lng: number;
}

interface TransportEstimate {
  mode: string;
  emoji: string;
  icon: any;
  duration: string;
  cost: string;
  colorClass: string;
}

export default function Maps() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Selected locations
  const [source, setSource] = useState<LocationInfo | undefined>(undefined);
  const [destination, setDestination] = useState<LocationInfo | undefined>(undefined);

  // Text inputs
  const [sourceInput, setSourceInput] = useState("");
  const [destInput, setDestInput] = useState("");

  // Dropdown suggestions lists
  const [sourceSuggestions, setSourceSuggestions] = useState<LocationInfo[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<LocationInfo[]>([]);

  // Show/Hide dropdowns
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);

  // OSRM Routing states
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string; rawDistanceKm: number } | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Nominatim Search debouncing
  const sourceDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const destDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Initialize Destination from query parameter if present
  useEffect(() => {
    const destinationId = searchParams.get("destination");
    if (destinationId) {
      const match = tnDestinations.find((d) => d.id === destinationId);
      if (match) {
        const loc = { name: match.name, lat: match.lat, lng: match.lng };
        setDestination(loc);
        setDestInput(match.name);
      }
    }
  }, [searchParams]);

  // Sync state to URL Query Parameters
  useEffect(() => {
    const params: Record<string, string> = {};
    if (source) {
      params.sourceLat = source.lat.toString();
      params.sourceLng = source.lng.toString();
      params.sourceName = source.name;
    }
    if (destination) {
      const match = tnDestinations.find(
        (d) =>
          Math.abs(d.lat - destination.lat) < 0.001 &&
          Math.abs(d.lng - destination.lng) < 0.001
      );
      if (match) {
        params.destination = match.id;
      } else {
        params.destLat = destination.lat.toString();
        params.destLng = destination.lng.toString();
        params.destName = destination.name;
      }
    }
    setSearchParams(params, { replace: true });
  }, [source, destination, setSearchParams]);

  // Fetch Route and Exact Distance from OSRM when both Source and Destination are available
  useEffect(() => {
    if (!source || !destination) {
      setRouteGeometry([]);
      setRouteInfo(null);
      setErrorMsg("");
      return;
    }

    const getRoute = async () => {
      setIsLoadingRoute(true);
      setErrorMsg("");
      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${source.lng},${source.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`
        );
        if (!response.ok) {
          throw new Error("Failed to reach OSRM routing server.");
        }
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const coords: [number, number][] = route.geometry.coordinates.map(
            (c: [number, number]) => [c[1], c[0]]
          );
          setRouteGeometry(coords);

          // Get precise distance (no assumptions/approximations)
          const distanceInKm = route.distance / 1000;
          const durationMins = Math.round(route.duration / 60);
          const hours = Math.floor(durationMins / 60);
          const mins = durationMins % 60;
          const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins} mins`;

          setRouteInfo({
            distance: `${distanceInKm.toFixed(2)} km`,
            duration: durationStr,
            rawDistanceKm: distanceInKm
          });
        } else {
          setErrorMsg("Could not find a driving route between these locations.");
        }
      } catch (err: any) {
        console.error("OSRM fetch error:", err);
        setErrorMsg("Failed to calculate exact distance. Please verify your connection.");
      } finally {
        setIsLoadingRoute(false);
      }
    };

    getRoute();
  }, [source, destination]);

  // Handle Search Input Geocoding (local tnDestinations + Nominatim fallback)
  const handleGeocodeSearch = (
    query: string,
    isSource: boolean,
    debounceRef: React.MutableRefObject<NodeJS.Timeout | null>
  ) => {
    const inputSetter = isSource ? setSourceInput : setDestInput;
    const suggestionsSetter = isSource ? setSourceSuggestions : setDestSuggestions;
    const dropdownOpenSetter = isSource ? setShowSourceDropdown : setShowDestDropdown;

    inputSetter(query);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim().length < 2) {
      suggestionsSetter([]);
      dropdownOpenSetter(false);
      return;
    }

    // 1. Search local tnDestinations database first (immediate response)
    const localMatches = tnDestinations
      .filter((d) =>
        d.name.toLowerCase().includes(query.toLowerCase()) ||
        d.fullName.toLowerCase().includes(query.toLowerCase()) ||
        d.district.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 4)
      .map((d) => ({ name: `${d.emoji} ${d.name} (${d.district} Dist)`, lat: d.lat, lng: d.lng }));

    suggestionsSetter(localMatches);
    dropdownOpenSetter(localMatches.length > 0);

    // 2. Debounced API call to OSM Nominatim for custom locations in India / Tamil Nadu
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
            query
          )}&format=json&limit=5&countrycodes=in&viewbox=75.0,8.0,81.5,14.0&bounded=1`
        );
        if (!response.ok) return;
        const data = await response.json();

        const apiMatches = data.map((item: any) => {
          const parts = item.display_name.split(",");
          const displayName = parts.slice(0, 3).join(",").trim();
          return {
            name: `📍 ${displayName}`,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
          };
        });

        // Combine local results (high priority) with API matches
        suggestionsSetter((prev) => {
          const combined = [...prev];
          apiMatches.forEach((apiItem: LocationInfo) => {
            // Check if already in combined list to prevent duplicates
            const exists = combined.some(
              (p) => Math.abs(p.lat - apiItem.lat) < 0.001 && Math.abs(p.lng - apiItem.lng) < 0.001
            );
            if (!exists) {
              combined.push(apiItem);
            }
          });
          return combined.slice(0, 6);
        });
        dropdownOpenSetter(true);
      } catch (error) {
        console.error("Nominatim search failed:", error);
      }
    }, 400);
  };

  // Get current browser geolocation
  const handleMyLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const myLoc = { name: "📍 Current Location", lat, lng };
          setSource(myLoc);
          setSourceInput("Current Location");
          setShowSourceDropdown(false);
        },
        (error) => {
          console.error("Geolocation error:", error);
          setErrorMsg("Could not access your location. Check browser permissions.");
        }
      );
    } else {
      setErrorMsg("Geolocation is not supported by your browser.");
    }
  };

  // Swap Source and Destination values
  const handleSwap = () => {
    const tempSource = source;
    const tempInput = sourceInput;

    setSource(destination);
    setSourceInput(destInput);

    setDestination(tempSource);
    setDestInput(tempInput);

    setShowSourceDropdown(false);
    setShowDestDropdown(false);
  };

  // Clear inputs
  const handleClear = (isSource: boolean) => {
    if (isSource) {
      setSource(undefined);
      setSourceInput("");
      setSourceSuggestions([]);
      setShowSourceDropdown(false);
    } else {
      setDestination(undefined);
      setDestInput("");
      setDestSuggestions([]);
      setShowDestDropdown(false);
    }
  };

  // Calculate local budget transport estimates based on exact route distance
  const getTransitEstimates = (distanceKm: number): TransportEstimate[] => {
    // 1. Train Estimate (Sleeper Class / General average in Tamil Nadu)
    const trainSpeed = 55; // km/h
    const trainRate = 0.6; // ₹ per km
    const trainHours = Math.max(1, Math.round(distanceKm / trainSpeed));
    const trainCost = Math.max(65, Math.round(distanceKm * trainRate));

    // 2. TNSTC Bus Estimate (Ordinary / Express average fare)
    const busSpeed = 45; // km/h
    const busRate = 1.35; // ₹ per km
    const busHours = Math.max(1, Math.round(distanceKm / busSpeed));
    const busCost = Math.max(50, Math.round(distanceKm * busRate));

    // 3. Private Cab/Auto (Budget hatchback class)
    const cabSpeed = 60; // km/h
    const cabRate = 14.5; // ₹ per km
    const cabHours = Math.max(1, Math.round(distanceKm / cabSpeed));
    const cabCost = Math.max(600, Math.round(distanceKm * cabRate));

    return [
      {
        mode: "Express Train",
        emoji: "🚂",
        icon: Train,
        duration: `${trainHours} hrs`,
        cost: `₹${trainCost.toLocaleString("en-IN")}`,
        colorClass: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400",
      },
      {
        mode: "TNSTC Bus",
        emoji: "🚌",
        icon: Bus,
        duration: `${busHours} hrs`,
        cost: `₹${busCost.toLocaleString("en-IN")}`,
        colorClass: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400",
      },
      {
        mode: "Budget Cab",
        emoji: "🚗",
        icon: Car,
        duration: `${cabHours} hrs`,
        cost: `₹${cabCost.toLocaleString("en-IN")}`,
        colorClass: "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400",
      },
    ];
  };

  const transitEstimates = routeInfo ? getTransitEstimates(routeInfo.rawDistanceKm) : [];

  return (
    <div className="relative w-full h-[calc(100vh-80px)] overflow-hidden">
      {/* Floating control overlay panel */}
      <div className="absolute top-4 left-4 z-[1000] w-[calc(100%-2rem)] sm:w-96 max-h-[calc(100vh-120px)] overflow-y-auto pointer-events-auto">
        <div className="bg-card/90 dark:bg-card/95 backdrop-blur-md border border-border/80 rounded-2xl shadow-elevated p-4 sm:p-5 space-y-4">
          
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <div className="w-8 h-8 rounded-lg gradient-saffron flex items-center justify-center text-white">
              <RouteIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-foreground leading-tight">
                Sikkanam Distance Calc
              </h2>
              <p className="text-[11px] text-muted-foreground">Tamil Nadu route & budget estimator</p>
            </div>
          </div>

          {/* Form Fields */}
          <div className="relative space-y-3">
            
            {/* Source Input */}
            <div className="relative">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Starting Point
                </label>
                {source && (
                  <button
                    onClick={() => handleClear(true)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                  >
                    Clear <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  <Input
                    className="pl-9 pr-8 py-2.5 h-11 bg-background/50 border-border focus:bg-background transition-all"
                    placeholder="Search start city (e.g. Chennai)..."
                    value={sourceInput}
                    onChange={(e) => handleGeocodeSearch(e.target.value, true, sourceDebounceTimer)}
                    onFocus={() => setShowSourceDropdown(sourceSuggestions.length > 0)}
                  />
                  {sourceInput && (
                    <button
                      onClick={() => handleClear(true)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 border-border transition-colors"
                  onClick={handleMyLocation}
                  title="Use My Current Location"
                >
                  <Crosshair className="w-4 h-4" />
                </Button>
              </div>

              {/* Source Suggestions Dropdown */}
              {showSourceDropdown && sourceSuggestions.length > 0 && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSourceDropdown(false)} />
                  <ul className="absolute left-0 right-0 mt-1 bg-popover/95 backdrop-blur-md border border-border rounded-xl shadow-elevated z-50 max-h-48 overflow-y-auto py-1 divide-y divide-border/20">
                    {sourceSuggestions.map((s, idx) => (
                      <li
                        key={idx}
                        className="px-4 py-2.5 text-sm hover:bg-accent/80 cursor-pointer transition-colors text-left flex items-center gap-2"
                        onClick={() => {
                          setSource(s);
                          setSourceInput(s.name.replace(/^[^\s]+\s/, "")); // strip emoji prefix
                          setShowSourceDropdown(false);
                        }}
                      >
                        <span className="truncate">{s.name}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* Swap Button container */}
            <div className="flex justify-center -my-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full border-border/80 bg-background shadow-card hover:bg-accent hover:scale-105 active:scale-95 transition-all"
                onClick={handleSwap}
                title="Swap locations"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </div>

            {/* Destination Input */}
            <div className="relative">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Destination
                </label>
                {destination && (
                  <button
                    onClick={() => handleClear(false)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                  >
                    Clear <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="relative">
                <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-500" />
                <Input
                  className="pl-9 pr-8 py-2.5 h-11 bg-background/50 border-border focus:bg-background transition-all"
                  placeholder="Search destination (e.g. Ooty)..."
                  value={destInput}
                  onChange={(e) => handleGeocodeSearch(e.target.value, false, destDebounceTimer)}
                  onFocus={() => setShowDestDropdown(destSuggestions.length > 0)}
                />
                {destInput && (
                  <button
                    onClick={() => handleClear(false)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Destination Suggestions Dropdown */}
              {showDestDropdown && destSuggestions.length > 0 && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowDestDropdown(false)} />
                  <ul className="absolute left-0 right-0 mt-1 bg-popover/95 backdrop-blur-md border border-border rounded-xl shadow-elevated z-50 max-h-48 overflow-y-auto py-1 divide-y divide-border/20">
                    {destSuggestions.map((s, idx) => (
                      <li
                        key={idx}
                        className="px-4 py-2.5 text-sm hover:bg-accent/80 cursor-pointer transition-colors text-left flex items-center gap-2"
                        onClick={() => {
                          setDestination(s);
                          setDestInput(s.name.replace(/^[^\s]+\s/, "")); // strip emoji prefix
                          setShowDestDropdown(false);
                        }}
                      >
                        <span className="truncate">{s.name}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

          </div>

          {/* Loader */}
          {isLoadingRoute && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>Calculating exact route...</span>
            </div>
          )}

          {/* Error Alert Box */}
          {errorMsg && (
            <div className="flex gap-2 bg-destructive/10 text-destructive text-xs border border-destructive/20 rounded-xl p-3 items-start animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Exact Distance display & transport breakdown card */}
          {routeInfo && (
            <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
              
              {/* Exact Stats Display */}
              <div className="bg-primary/5 dark:bg-primary/10 rounded-xl p-3 border border-primary/20 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Exact Driving Distance
                  </p>
                  <p className="text-xl font-bold font-display text-primary mt-0.5">
                    {routeInfo.distance}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Road Travel Time
                  </p>
                  <p className="text-sm font-bold text-foreground mt-1 flex items-center gap-1 justify-end">
                    <Clock className="w-4 h-4 text-muted-foreground" /> {routeInfo.duration}
                  </p>
                </div>
              </div>

              {/* Transit Cost & Speed Estimates */}
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Tamil Nadu Transit Estimator
                </h4>
                
                <div className="grid grid-cols-1 gap-2">
                  {transitEstimates.map((item, idx) => {
                    const IconComp = item.icon;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all ${item.colorClass}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-xl">{item.emoji}</span>
                          <div>
                            <p className="text-xs font-bold text-foreground leading-tight">
                              {item.mode}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Average journey duration
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-foreground leading-none">
                            {item.cost}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1 font-semibold">
                            {item.duration}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[9px] text-muted-foreground italic leading-tight text-left mt-2">
                  * Fare estimates are based on current TNSTC state passenger rates (₹1.35/km), general express train routes (₹0.6/km), and budget cab hires (₹14.5/km).
                </p>
              </div>

            </div>
          )}

        </div>
      </div>

      {/* Main Map component */}
      <div className="w-full h-full">
        <SikkanamMap
          source={source}
          destination={destination}
          routeGeometry={routeGeometry}
        />
      </div>
    </div>
  );
}