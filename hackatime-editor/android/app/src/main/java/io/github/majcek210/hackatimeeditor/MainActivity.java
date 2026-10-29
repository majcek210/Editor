package io.github.majcek210.hackatimeeditor;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.majcek210.hackatimeeditor.git.GitPlugin;
import io.github.majcek210.hackatimeeditor.wakacli.WakaCliPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakaCliPlugin.class);
        registerPlugin(GitPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
