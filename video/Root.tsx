import React from 'react';
import {Composition} from 'remotion';
import {LyricVideo} from './LyricVideo';
import type {VideoProps} from './types';

const defaults: VideoProps = {
  style:{width:1920,height:1080,fps:30,fontSize:58,bottomPercent:12,color:'#ffffff',stroke:3,lineHeight:1.35,dim:0.22,fit:'contain',showTitle:false,nextLine:false},
  tracks:[],
};
export const RemotionRoot: React.FC = () => <Composition
  id="LyricVideo" component={LyricVideo} width={1920} height={1080} fps={30} durationInFrames={30}
  defaultProps={defaults}
  calculateMetadata={({props}) => ({
    width:props.style.width, height:props.style.height, fps:props.style.fps,
    durationInFrames:Math.max(1, ...props.tracks.map(t => t.from + t.durationInFrames)),
  })}
/>;
