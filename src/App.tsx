import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="container">
      <h1>Note67</h1>
      <p>Your private, local meeting notes assistant</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Greet</button>
      </form>

      <p>{greetMsg}</p>

      <div className="features">
        <h2>Coming Soon</h2>
        <ul>
          <li>Audio capture during meetings</li>
          <li>Local transcription with Whisper</li>
          <li>AI-powered meeting summaries</li>
          <li>Private, on-device processing</li>
        </ul>
      </div>
    </main>
  );
}

export default App;
