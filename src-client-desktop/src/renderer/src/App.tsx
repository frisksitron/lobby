import { HashRouter, Route } from "@solidjs/router"
import AppLayout from "./layouts/AppLayout"
import AuthView from "./views/AuthView"
import ServerView from "./views/ServerView"
import SettingsView from "./views/SettingsView"

const App = () => (
  <HashRouter root={AppLayout}>
    <Route path="/auth" component={AuthView} />
    <Route path="/server/:serverId" component={ServerView} />
    <Route path="/settings/:tab?" component={SettingsView} />
    <Route path="*" component={AuthView} />
  </HashRouter>
)

export default App
