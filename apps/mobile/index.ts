import { registerRootComponent } from "expo";
// Define the background task before loading and registering the application.
import "./src/provider-location";
import App from "./App";

registerRootComponent(App);
