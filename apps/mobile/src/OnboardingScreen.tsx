import { useEffect, useState } from "react";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
type CountryOption = { name: string; code: string; dialCode: string };
type AddressSuggestion = { label: string; latitude: number; longitude: number };
import { MapPinPicker } from "./MapPinPicker";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "./api";

type Section = "Profile" | "Verification" | "Skills" | "Portfolio" | "Submit";
type AccountType = "INDIVIDUAL" | "BUSINESS";
type MarketplaceRole = "SEEKER" | "PROVIDER";
type Payload = {
  profile: Record<string, string>;
  skills: Array<{ category: string; description: string; supportingDocuments: Array<{ name: string; url: string }> }>;
  portfolio: Array<{ title: string; description: string }>;
  percentage: number;
  sections: { profile: boolean; skills: boolean; portfolio: boolean };
};

const tabs: Section[] = ["Profile", "Verification", "Skills", "Portfolio", "Submit"];
const empty: Payload = { profile: {}, skills: [], portfolio: [], percentage: 0, sections: { profile: false, skills: false, portfolio: false } };
const colors = { ink: "#182238", muted: "#778198", primary: "#294FC5", border: "#E2E7F0", surface: "#FFFFFF", bg: "#F7F8FC", hero: "#111D36", soft: "#F0F4FF" };

export function OnboardingScreen(p: { identityStatus: string; onBack: () => void; onStartVerification: () => void }) {
  const [active, setActive] = useState<Section>("Profile");
  const [data, setData] = useState<Payload>(empty);
  const [accountType, setAccountType] = useState<AccountType | "">("");
  const [marketplaceRole, setMarketplaceRole] = useState<MarketplaceRole | "">("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneDialCode, setPhoneDialCode] = useState("+27");
  const [phoneCountrySearch, setPhoneCountrySearch] = useState("");
  const [showPhoneCountries, setShowPhoneCountries] = useState(false);
  const [countries, setCountries] = useState<CountryOption[]>([{ name: "South Africa", code: "ZA", dialCode: "+27" }]);
  const [countrySearch, setCountrySearch] = useState("");
  const [showCountries, setShowCountries] = useState(false);
  const [country, setCountry] = useState("South Africa");
  const [countryCode, setCountryCode] = useState("ZA");
  const [regions, setRegions] = useState<string[]>([]);
  const [regionSearch, setRegionSearch] = useState("");
  const [showRegions, setShowRegions] = useState(false);
  const [regionsBusy, setRegionsBusy] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [suburb, setSuburb] = useState("");
  const [address, setAddress] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [identityStatus, setIdentityStatus] = useState(p.identityStatus);
  const [idDocumentReady, setIdDocumentReady] = useState(false);
  const [selfieReady, setSelfieReady] = useState(false);
  const [homeLatitude, setHomeLatitude] = useState("");
  const [homeLongitude, setHomeLongitude] = useState("");
  const [homeLocationBusy, setHomeLocationBusy] = useState(false);
  const [addressSearchBusy, setAddressSearchBusy] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [portfolioTitle, setPortfolioTitle] = useState("");
  const [portfolioDescription, setPortfolioDescription] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<Payload>("/profile/onboarding", {}, true);
      const home = await apiRequest<{homeLocationLabel:string|null;homeLatitude:number|null;homeLongitude:number|null}>("/profile/location/home", {}, true).catch(() => null);
      const verification = await apiRequest<{status:string;latestCase:{status:string}|null;idDocumentUploaded:boolean;selfieUploaded:boolean}>("/identity-verification/status", {}, true).catch(() => null);
      if (verification) { setIdentityStatus(verification.latestCase?.status ?? verification.status); setIdDocumentReady(verification.idDocumentUploaded); setSelfieReady(verification.selfieUploaded); }
      setData(result);
      const profile = result.profile ?? {};
      setAccountType(profile.accountType === "INDIVIDUAL" || profile.accountType === "BUSINESS" ? profile.accountType : "");
      setMarketplaceRole(profile.marketplaceRole === "SEEKER" || profile.marketplaceRole === "PROVIDER" ? profile.marketplaceRole : "");
      setFirstName(profile.firstName ?? ""); setLastName(profile.lastName ?? ""); setPhone(profile.phone ?? "");
      setPhoneDialCode(profile.phoneDialCode ?? "+27");
      setCountry(profile.country ?? "South Africa"); setCountryCode(profile.countryCode ?? "ZA"); setProvince(profile.province ?? ""); setCity(profile.city ?? "");
      setSuburb(profile.suburb ?? ""); setAddress(profile.address ?? ""); setHouseNumber(profile.houseNumber ?? "");
      setHomeLatitude(home?.homeLatitude == null ? "" : String(home.homeLatitude));
      setHomeLongitude(home?.homeLongitude == null ? "" : String(home.homeLongitude));
      const skill = result.skills?.[0]; setCategory(skill?.category ?? ""); setDescription(skill?.description ?? "");
      const document = skill?.supportingDocuments?.[0]; setDocumentName(document?.name ?? ""); setDocumentUrl(document?.url ?? "");
      const item = result.portfolio?.[0]; setPortfolioTitle(item?.title ?? ""); setPortfolioDescription(item?.description ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your saved profile."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("https://restcountries.com/v3.1/all?fields=name,cca2,idd")
      .then((response) => { if (!response.ok) throw new Error("Country list unavailable"); return response.json(); })
      .then((items: Array<{ name?: { common?: string }; cca2?: string; idd?: { root?: string; suffixes?: string[] } }>) => {
        const parsed = items.map((item) => {
          const root = item.idd?.root ?? "";
          const suffix = item.idd?.suffixes?.length === 1 ? item.idd.suffixes[0] : "";
          return { name: item.name?.common ?? "", code: item.cca2 ?? "", dialCode: root + suffix };
        }).filter((item) => item.name && item.code && item.dialCode)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled && parsed.length) {
          setCountries(parsed);
          const selected = parsed.find((item) => item.code === countryCode || item.name === country) ?? parsed.find((item) => item.code === "ZA");
          if (selected) { setCountry(selected.name); setCountryCode(selected.code); }
        }
      })
      .catch(() => { /* Keep South Africa available as the offline-safe default. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRegions([]);
    if (!country) return;
    setRegionsBusy(true);
    fetch("https://countriesnow.space/api/v0.1/countries/states", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country }),
    })
      .then((response) => { if (!response.ok) throw new Error("Regions unavailable"); return response.json(); })
      .then((result: { data?: { states?: Array<{ name?: string }> } }) => {
        if (!cancelled) setRegions((result.data?.states ?? []).map((item) => item.name ?? "").filter(Boolean).sort());
      })
      .catch(() => { if (!cancelled) setRegions([]); })
      .finally(() => { if (!cancelled) setRegionsBusy(false); });
    return () => { cancelled = true; };
  }, [country]);

  const save = async (section: "profile" | "skills" | "portfolio"): Promise<boolean> => {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = section === "profile" ? { profile: { accountType, marketplaceRole, firstName, lastName, phone, phoneDialCode, country, countryCode, province, city, suburb, address, houseNumber } }
        : section === "skills" ? { skills: category.trim() ? [{ category: category.trim(), description, supportingDocuments: documentName.trim() && documentUrl.trim() ? [{ name: documentName.trim(), url: documentUrl.trim() }] : [] }] : [] }
        : { portfolio: portfolioTitle.trim() ? [{ title: portfolioTitle.trim(), description: portfolioDescription }] : [] };
      const result = await apiRequest<Payload>("/profile/onboarding", { method: "PATCH", body: JSON.stringify(body) }, true);
      setData(result);
      if (section === "profile" && (homeLatitude.trim() || homeLongitude.trim())) {
        if (!homeLatitude.trim() || !homeLongitude.trim()) throw new Error("Choose both latitude and longitude for your Home Location.");
        if (!Number.isFinite(Number(homeLatitude)) || !Number.isFinite(Number(homeLongitude)) || Number(homeLatitude) < -90 || Number(homeLatitude) > 90 || Number(homeLongitude) < -180 || Number(homeLongitude) > 180) throw new Error("Enter valid Home Location coordinates.");
        await apiRequest("/profile/location/home", { method: "PATCH", body: JSON.stringify({ label: [address, suburb, city, province, country].filter(Boolean).join(", ") || "Saved Home Location", latitude: Number(homeLatitude), longitude: Number(homeLongitude) }) }, true);
      }
      setMessage("Your changes have been saved as a draft.");
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this section."); return false; }
    finally { setBusy(false); }
  };

  const useCurrentHomeLocation = async () => {
    setHomeLocationBusy(true); setError(""); setMessage("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error("Location permission was not granted. You can search for or enter your home address manually.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setHomeLatitude(String(current.coords.latitude));
      setHomeLongitude(String(current.coords.longitude));
      const places = await Location.reverseGeocodeAsync({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      const place = places[0];
      if (place) {
        if (place.country) {
          setCountry(place.country);
          const matchedCountry = countries.find((item) => item.name.toLowerCase() === place.country?.toLowerCase());
          if (matchedCountry) setCountryCode(matchedCountry.code);
        }
        if (place.region) setProvince(place.region);
        if (place.city || place.subregion) setCity(place.city ?? place.subregion ?? "");
        if (place.district) setSuburb(place.district);
        const readable = [place.name, place.street, place.district, place.city ?? place.subregion, place.region, place.postalCode, place.country].filter(Boolean);
        if (readable.length) setAddress([...new Set(readable)].join(", "));
        setMessage("Your current address and map pin were added. Review the address, then save your profile.");
      } else {
        setMessage("Current map pin added. Add or search for a readable home address before saving.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read your current location."); }
    finally { setHomeLocationBusy(false); }
  };

  const searchHomeAddress = async (query: string) => {
    setAddress(query);
    if (query.trim().length < 3) { setAddressSuggestions([]); return; }
    setAddressSearchBusy(true);
    try {
      const response = await fetch("https://photon.komoot.io/api/?limit=10&lang=en&q=" + encodeURIComponent(query.trim() + ", " + country));
      if (!response.ok) throw new Error("Address search is temporarily unavailable.");
      const result = await response.json() as { features?: Array<{ properties?: { name?: string; street?: string; housenumber?: string; district?: string; city?: string; state?: string; country?: string; postcode?: string }; geometry?: { coordinates?: number[] } }> };
      const options: AddressSuggestion[] = (result.features ?? []).flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates;
        const longitude = coordinates?.[0];
        const latitude = coordinates?.[1];
        if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        const props = feature.properties ?? {};
        const label = [props.street ?? props.name, props.district, props.city, props.state, props.postcode, props.country].filter(Boolean).join(", ");
        return label ? [{ label: [props.housenumber, label].filter(Boolean).join(" "), latitude, longitude }] : [];
      });
      setAddressSuggestions(options);
    } catch (e) {
      setAddressSuggestions([]);
      setError(e instanceof Error ? e.message : "Could not search for this address.");
    } finally { setAddressSearchBusy(false); }
  };

  const selectAddress = (item: AddressSuggestion) => {
    setAddress(item.label);
    setHomeLatitude(String(item.latitude));
    setHomeLongitude(String(item.longitude));
    setAddressSuggestions([]);
    setMessage("Address selected and map pin updated. You can fine-tune the pin on the map.");
  };

  const updatePin = async (latitude: number, longitude: number) => {
    setHomeLatitude(String(latitude));
    setHomeLongitude(String(longitude));
    try {
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = places[0];
      if (place) {
        const readable = [place.name, place.street, place.district, place.city ?? place.subregion, place.region, place.postalCode, place.country].filter(Boolean);
        if (readable.length) setAddress([...new Set(readable)].join(", "));
      }
    } catch { /* Keep the manually entered address if reverse geocoding is unavailable. */ }
  };

  const saveAndContinue = async () => {
    if (await save("profile")) setActive("Verification");
  };

  const uploadIdentityImage = async (purpose: "ID_DOCUMENT" | "ID_SELFIE") => {
    setBusy(true); setError(""); setMessage("");
    try {
      const picked = purpose === "ID_SELFIE" ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const contentType = asset.mimeType ?? "image/jpeg";
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Please use a JPEG, PNG or WebP image.");
      const blob = await (await fetch(asset.uri)).blob();
      const fileName = asset.fileName ?? (purpose === "ID_SELFIE" ? "identity-selfie.jpg" : "identity-document.jpg");
      const reservation = await apiRequest<{assetId:string;cloudName:string;apiKey:string;timestamp:number;signature:string;publicId:string;assetFolder:string}>("/identity-verification/uploads", { method: "POST", body: JSON.stringify({ fileName, contentType, sizeBytes: asset.fileSize ?? blob.size, purpose }) }, true);
      const form = new FormData();
      form.append("file", blob, fileName); form.append("api_key", reservation.apiKey); form.append("timestamp", String(reservation.timestamp)); form.append("signature", reservation.signature); form.append("public_id", reservation.publicId); form.append("asset_folder", reservation.assetFolder); form.append("overwrite", "false"); form.append("unique_filename", "false"); form.append("use_filename", "false");
      const response = await fetch("https://api.cloudinary.com/v1_1/" + reservation.cloudName + "/image/authenticated/upload", { method: "POST", body: form });
      if (!response.ok) throw new Error("Secure image upload failed. Please try again.");
      await apiRequest("/identity-verification/uploads/confirm", { method: "POST", body: JSON.stringify({ assetId: reservation.assetId }) }, true);
      if (purpose === "ID_DOCUMENT") setIdDocumentReady(true); else setSelfieReady(true);
      setMessage(purpose === "ID_DOCUMENT" ? "ID document uploaded securely." : "Selfie captured and uploaded securely.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not upload verification image."); }
    finally { setBusy(false); }
  };

  const submitIdentityVerification = async () => {
    if (!idDocumentReady || !selfieReady) { setError("Upload your ID document and take a selfie before continuing."); return false; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{status:string;message?:string}>("/identity-verification/submit", { method: "POST", body: "{}" }, true);
      setIdentityStatus(result.status); setMessage(result.message ?? "Your identity documents were submitted for administrator review."); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit identity verification."); return false; }
    finally { setBusy(false); }
  };

  const saveCurrent = async () => {
    if (active === "Profile") return save("profile");
    if (active === "Skills") return save("skills");
    if (active === "Portfolio") return save("portfolio");
    if (active === "Verification") { setMessage("Uploaded verification images are saved securely."); return true; }
    if (!await save("profile") || !await save("skills")) return false;
    return save("portfolio");
  };

  const continueCurrent = async () => {
    if (active === "Profile") { if (await save("profile")) setActive("Verification"); return; }
    if (active === "Verification") { if (await submitIdentityVerification()) setActive("Skills"); return; }
    if (active === "Skills") { if (await save("skills")) setActive("Portfolio"); return; }
    if (active === "Portfolio") { if (await save("portfolio")) setActive("Submit"); return; }
    if (await saveCurrent()) await submit();
  };
  const submit = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/profile/onboarding/submit", { method: "POST", body: "{}" }, true);
      setMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your available information."); }
    finally { setBusy(false); }
  };

  const status = (key: "profile" | "skills" | "portfolio") => data.sections?.[key] ? "Complete" : "Draft / not complete";
  const next = () => setActive(tabs[Math.min(tabs.indexOf(active) + 1, tabs.length - 1)] ?? "Submit");
  const Field = (label: string, value: string, change: (v: string) => void, multiline = false) => (
    <View style={st.field} key={label}><Text style={st.label}>{label}</Text><TextInput value={value} onChangeText={change} multiline={multiline} placeholder={label} placeholderTextColor="#93A099" style={[st.input, multiline && st.multiline]} /></View>
  );

  return <View style={st.container}>
    <View style={st.hero}>
      <View style={st.heroTop}>
        <Text style={st.brand}>anyskill<Text style={st.brandAccent}>.</Text></Text>
        <Pressable onPress={p.onBack} accessibilityRole="button" style={st.backButton}><Text style={st.back}>Back</Text></Pressable>
      </View>
      <Text style={st.heroTitle}>Let's build your profile.</Text>
      <Text style={st.heroSubtitle}>Tell us a little about yourself so we can create the right AnySkill experience.</Text>
    </View>
    <View style={st.progressWrap}>
      <View style={st.progressMeta}>
        <View><Text style={st.stepCount}>Step {tabs.indexOf(active) + 1} of 5</Text><Text style={st.percent}>{active} information</Text></View>
        <Text style={st.percentStrong}>{data.percentage}% complete</Text>
      </View>
      <View style={st.track}><View style={[st.fill, { width: `${data.percentage}%` }]} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabs}>
        {tabs.map((tab, index) => <Pressable key={tab} onPress={() => setActive(tab)} style={[st.tab, active === tab && st.activeTab, tabs.indexOf(active) > index && st.doneTab]}><View style={[st.stepDot, active === tab && st.activeDot, tabs.indexOf(active) > index && st.doneDot]}><Text style={[st.stepDotText, (active === tab || tabs.indexOf(active) > index) && st.activeDotText]}>{tabs.indexOf(active) > index ? "✓" : index + 1}</Text></View><Text style={[st.tabText, active === tab && st.activeTabText]}>{tab}</Text></Pressable>)}
      </ScrollView>
    </View>
    <ScrollView style={st.body} contentContainerStyle={{ paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      {busy && <ActivityIndicator color={colors.primary} />}
      {active === "Profile" && <>
        <Text style={st.heading}>Set up your profile</Text>
        <Text style={st.help}>First choose whether this profile represents you as an individual or a business, then choose how you want to participate in AnySkill. You can save a draft and finish later.</Text>
        <Text style={st.label}>Account type</Text>
        <View style={st.choiceRow}>
          <Choice label="Individual" description="A personal profile" selected={accountType === "INDIVIDUAL"} onPress={() => setAccountType("INDIVIDUAL")} />
          <Choice label="Business" description="A company or organisation" selected={accountType === "BUSINESS"} onPress={() => setAccountType("BUSINESS")} />
        </View>
        <Text style={st.label}>Marketplace role</Text>
        <View style={st.choiceRow}>
          <Choice label="Skill Seeker" description="Find people, skills or services" selected={marketplaceRole === "SEEKER"} onPress={() => setMarketplaceRole("SEEKER")} />
          <Choice label="Skill Provider" description="Offer skills, services or capabilities" selected={marketplaceRole === "PROVIDER"} onPress={() => setMarketplaceRole("PROVIDER")} />
        </View>
        <Text style={st.help}>You can use AnySkill to seek and provide through one account. This selection sets your current profile role; it does not prevent you from using the other mode later.</Text>
        {Field("First name", firstName, setFirstName)}{Field("Last name", lastName, setLastName)}
        <Text style={st.label}>Contact number</Text>
        <View style={st.inlineFields}>
          <View style={st.codeField}>
            <Pressable style={st.selectInput} onPress={() => setShowPhoneCountries((value) => !value)}><Text style={st.selectText}>{phoneDialCode} ▾</Text></Pressable>
          </View>
          <View style={st.phoneField}><TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor="#93A099" style={st.input} /></View>
        </View>
        {showPhoneCountries && <View style={st.optionPanel}>
          <TextInput value={phoneCountrySearch} onChangeText={setPhoneCountrySearch} placeholder="Search calling code or country" style={st.searchInput} />
          {countries.filter((item) => (item.name + " " + item.dialCode).toLowerCase().includes(phoneCountrySearch.toLowerCase())).slice(0, 12).map((item) =>
            <Pressable key={item.code} style={st.option} onPress={() => { setPhoneDialCode(item.dialCode); setShowPhoneCountries(false); setPhoneCountrySearch(""); }}>
              <Text style={st.optionText}>{item.name} ({item.dialCode})</Text>
            </Pressable>)}
        </View>}
        <Text style={st.label}>Country</Text>
        <Pressable style={st.selectInput} onPress={() => setShowCountries((value) => !value)}><Text style={st.selectText}>{country} ▾</Text></Pressable>
        {showCountries && <View style={st.optionPanel}>
          <TextInput value={countrySearch} onChangeText={setCountrySearch} placeholder="Search country" style={st.searchInput} />
          {countries.filter((item) => item.name.toLowerCase().includes(countrySearch.toLowerCase())).slice(0, 14).map((item) =>
            <Pressable key={item.code} style={st.option} onPress={() => { setCountry(item.name); setCountryCode(item.code); setProvince(""); setShowCountries(false); setCountrySearch(""); }}>
              <Text style={st.optionText}>{item.name}</Text>
            </Pressable>)}
        </View>}
        <Text style={st.label}>Province / State</Text>
        <Pressable style={st.selectInput} onPress={() => setShowRegions((value) => !value)}><Text style={st.selectText}>{regionsBusy ? "Loading regions..." : province || "Select province / state"} ▾</Text></Pressable>
        {showRegions && <View style={st.optionPanel}>
          <TextInput value={regionSearch} onChangeText={setRegionSearch} placeholder="Search province / state" style={st.searchInput} />
          {regions.filter((item) => item.toLowerCase().includes(regionSearch.toLowerCase())).slice(0, 14).map((item) =>
            <Pressable key={item} style={st.option} onPress={() => { setProvince(item); setShowRegions(false); setRegionSearch(""); }}>
              <Text style={st.optionText}>{item}</Text>
            </Pressable>)}
          {!regionsBusy && regions.length === 0 && <Text style={st.optionHint}>No region list available for this country. You can type it below.</Text>}
        </View>}
        {Field("Province / State (manual entry)", province, setProvince)}
        {Field("City", city, setCity)}{Field("Suburb / District", suburb, setSuburb)}
        {Field("House / Building number", houseNumber, setHouseNumber)}
        <Text style={st.label}>Search home address</Text>
        <TextInput value={address} onChangeText={(value) => void searchHomeAddress(value)} placeholder="Start typing street, suburb or postcode" placeholderTextColor="#93A099" style={st.input} />
        {addressSearchBusy && <ActivityIndicator color={colors.primary} />}
        {addressSuggestions.length > 0 && <View style={st.optionPanel}>
          {addressSuggestions.map((item, index) => <Pressable key={item.label + index} style={st.option} onPress={() => selectAddress(item)}>
            <Text style={st.optionText}>{item.label}</Text>
          </Pressable>)}
        </View>}
        <Action label={homeLocationBusy ? "Getting location..." : "Use current GPS for Home Location"} onPress={() => void useCurrentHomeLocation()} disabled={busy || homeLocationBusy} />
        <Text style={st.help}>Search includes your selected country. Some map records only contain street names; enter the house or building number above when it is missing. Review the address and adjust the pin.</Text>
        <Text style={st.label}>Choose Home Location on the map</Text>
        <MapPinPicker latitude={homeLatitude.trim() && Number.isFinite(Number(homeLatitude)) ? Number(homeLatitude) : -26.2041} longitude={homeLongitude.trim() && Number.isFinite(Number(homeLongitude)) ? Number(homeLongitude) : 28.0473} selectedLatitude={homeLatitude.trim() ? Number(homeLatitude) : null} selectedLongitude={homeLongitude.trim() ? Number(homeLongitude) : null} onSelect={(lat, lon) => { void updatePin(lat, lon); }} />
        {Field("Home latitude", homeLatitude, setHomeLatitude)}{Field("Home longitude", homeLongitude, setHomeLongitude)}
        <Text style={st.help}>Home Location is saved to your profile and used as a default. It is not continuous live tracking. You can also type coordinates if map tiles are unavailable.</Text>
        <Text style={st.status}>Section: {status("profile")}</Text>
        <View style={st.saveButtons}><View style={st.saveButtonHalf}><Action label="Save" onPress={() => void save("profile")} disabled={busy} /></View><View style={st.saveButtonHalf}><Action label="Save & Continue" onPress={() => void saveAndContinue()} disabled={busy} /></View></View>
      </>}
      {active === "Verification" && <>
        <Text style={st.heading}>Identity verification</Text>
        <Text style={st.help}>Identity verification is separate from profile completion. You may continue building your profile, but verification is required before restricted marketplace actions.</Text>
        <View style={st.card}><Text style={st.label}>Current identity status</Text><Text style={st.statusValue}>{identityStatus.replace(/_/g, " ")}</Text></View>
        <Text style={st.label}>1. Upload ID document (front)</Text>
        <Text style={st.help}>Upload a clear photo of your government-issued ID. JPEG, PNG or WebP; maximum 10 MB.</Text>
        <Action label={idDocumentReady ? "Replace ID document" : "Upload ID document"} onPress={() => void uploadIdentityImage("ID_DOCUMENT")} disabled={busy} />
        <Text style={st.status}>{idDocumentReady ? "ID document uploaded" : "ID document not uploaded"}</Text>
        <Text style={st.label}>2. Take a selfie</Text>
        <Text style={st.help}>Use your device camera to take a clear selfie for administrator review.</Text>
        <Action label={selfieReady ? "Retake selfie" : "Take selfie"} onPress={() => void uploadIdentityImage("ID_SELFIE")} disabled={busy} />
        <Text style={st.status}>{selfieReady ? "Selfie uploaded" : "Selfie not captured"}</Text>
        <Text style={st.help}>Images are stored privately. An administrator will review them later; uploading does not automatically verify your identity.</Text>
      </>}
      {active === "Skills" && <>
        <Text style={st.heading}>Skills and experience</Text><Text style={st.help}>Add each skill and attach its supporting documents to that skill. You can skip this section and complete it later.</Text>
        {Field("Skill category", category, setCategory)}{Field("Experience and service description", description, setDescription, true)}
        {Field("Supporting document name", documentName, setDocumentName)}{Field("Supporting document URL (temporary)", documentUrl, setDocumentUrl)}
        <Text style={st.help}>Document upload to AnySkill-managed cloud storage will be connected separately; this field currently records a document reference only.</Text>
        <Text style={st.status}>Section: {status("skills")}</Text>
      </>}
      {active === "Portfolio" && <>
        <Text style={st.heading}>Portfolio</Text><Text style={st.help}>Add examples of previous work. This section is optional and can be completed later.</Text>
        {Field("Project or work title", portfolioTitle, setPortfolioTitle)}{Field("Description", portfolioDescription, setPortfolioDescription, true)}
        <Text style={st.status}>Section: {status("portfolio")}</Text>
      </>}
      {active === "Submit" && <>
        <Text style={st.heading}>Review and submit</Text><Text style={st.help}>Submitting saves the information currently available. It does not make your profile mandatory or grant identity-verified permissions. You can edit drafts later.</Text>
        <View style={st.card}><Text style={st.status}>Profile: {status("profile")}</Text><Text style={st.status}>Skills: {status("skills")}</Text><Text style={st.status}>Portfolio: {status("portfolio")}</Text><Text style={st.status}>Identity: {identityStatus.replace(/_/g, " ")}</Text></View>

      </>}
      {!!message && <Text style={st.success}>{message}</Text>}
      {!!error && <Text style={st.error}>{error}</Text>}
      <View style={st.saveButtons}>
        <View style={st.saveButtonHalf}><Action label="Save" onPress={() => void saveCurrent()} disabled={busy} /></View>
        <View style={st.saveButtonHalf}><Action label="Save & Continue" onPress={() => void continueCurrent()} disabled={busy} /></View>
      </View>
    </ScrollView>
  </View>;
}

function Action(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[st.action, p.disabled && { opacity: 0.45 }]}><Text style={st.actionText}>{p.label}</Text></Pressable>;
}
function Choice(p: { label: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: p.selected }} onPress={p.onPress} style={[st.choice, p.selected && st.choiceSelected]}>
    <View style={st.choiceTop}>
      <Text style={st.choiceTitle}>{p.label}</Text>
      <View style={[st.choiceRadio, p.selected && st.choiceRadioSelected]} />
    </View>
    <Text style={st.choiceDescription}>{p.description}</Text>
  </Pressable>;
}
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.hero, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 25, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 25 },
  brand: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", letterSpacing: 0.2 }, brandAccent: { color: "#83A4FF" },
  backButton: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: "#263655" }, back: { color: "#E3EAFF", fontSize: 12, fontWeight: "800" },
  heroTitle: { color: "#FFFFFF", fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.6 },
  heroSubtitle: { color: "#C3CDE0", fontSize: 13, lineHeight: 19, marginTop: 8, maxWidth: 340 },
  progressWrap: { paddingTop: 18 }, progressMeta: { paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepCount: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  percent: { color: colors.muted, fontSize: 11, marginTop: 3 }, percentStrong: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  track: { height: 6, marginHorizontal: 20, marginTop: 10, borderRadius: 8, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.primary, borderRadius: 8 },
  tabs: { gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  tab: { minWidth: 76, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  activeTab: { backgroundColor: colors.soft, borderColor: colors.primary }, doneTab: { borderColor: "#C9D8FF" },
  stepDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#E8EBF2" },
  activeDot: { backgroundColor: colors.primary }, doneDot: { backgroundColor: "#DCE7FF" },
  stepDotText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, activeDotText: { color: colors.primary },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: "800" }, activeTabText: { color: colors.primary },
  body: { flex: 1, paddingHorizontal: 20 }, heading: { color: colors.ink, fontSize: 21, fontWeight: "900", letterSpacing: -0.45, marginBottom: 8 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  choiceRow: { flexDirection: "row", gap: 10, marginBottom: 15 },
  choice: { flex: 1, minHeight: 104, borderWidth: 1.5, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface, padding: 13 },
  choiceSelected: { borderColor: colors.primary, borderWidth: 1.8, backgroundColor: colors.soft, padding: 12.7 },
  choiceTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  choiceTitle: { color: colors.ink, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  choiceDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  choiceRadio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border },
  choiceRadioSelected: { borderWidth: 5, borderColor: colors.primary },
  field: { marginBottom: 14 }, label: { color: colors.ink, fontSize: 12, fontWeight: "800", marginBottom: 7 },
  inlineFields: { flexDirection: "row", gap: 8, marginBottom: 14 }, codeField: { width: 104 }, phoneField: { flex: 1 },
  selectInput: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", paddingHorizontal: 14, justifyContent: "center", marginBottom: 12 },
  selectText: { color: colors.ink, fontSize: 14 }, optionPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", marginBottom: 14, maxHeight: 230, overflow: "hidden" },
  searchInput: { minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, color: colors.ink },
  option: { paddingHorizontal: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#EEF1F6" }, optionText: { color: colors.ink, fontSize: 13 }, optionHint: { color: colors.muted, padding: 12, fontSize: 12 },
  saveButtons: { flexDirection: "row", gap: 9 }, saveButtonHalf: { flex: 1 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", paddingHorizontal: 14, color: colors.ink, fontSize: 14 },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  status: { color: colors.muted, fontSize: 12, marginVertical: 6 }, statusValue: { color: colors.ink, fontWeight: "800", marginTop: 6, textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 17, marginVertical: 13, shadowColor: "#173B2C", shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  action: { backgroundColor: colors.primary, borderRadius: 11, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 10 },
  actionText: { color: "#FFF", fontWeight: "800", fontSize: 13 }, nav: { marginTop: 12, marginBottom: 25 },
  success: { color: colors.primary, marginTop: 12, fontSize: 12 }, error: { color: "#A12D2D", marginTop: 12, fontSize: 12 },
});
