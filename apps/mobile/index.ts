import { registerRootComponent } from "expo";
import App from "./App";
// Define the background task at module scope before the app is registered.
import "./src/provider-location";

registerRootComponent(App);
