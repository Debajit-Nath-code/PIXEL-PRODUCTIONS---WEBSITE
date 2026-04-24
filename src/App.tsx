import { motion, useScroll, useTransform, AnimatePresence } from 'motion/react';
import { ArrowRight, ArrowUpRight, Play, Mail, Instagram, Twitter, Linkedin, ArrowLeft, Pause, Volume2, VolumeX, X } from 'lucide-react';
import React, { useRef, useEffect, useState, useId } from 'react';
import { Routes, Route, Link, useParams, useLocation } from 'react-router-dom';

// --- COMPONENTS ---

const ProjectVideo = ({ project, className, isHero = false, useModal = false }: { project: any, className: string, isHero?: boolean, useModal?: boolean }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    
    const videoRef = useRef<HTMLVideoElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const layoutId = useId();

    const formatTime = (time: number) => {
        if (isNaN(time)) return "0:00";
        const mins = Math.floor(time / 60);
        const secs = Math.floor(time % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const updateProgress = (clientX: number) => {
        if (progressBarRef.current && videoRef.current && duration > 0) {
            const rect = progressBarRef.current.getBoundingClientRect();
            let pos = (clientX - rect.left) / rect.width;
            pos = Math.max(0, Math.min(1, pos));
            videoRef.current.currentTime = pos * duration;
            setProgress(pos * duration);
        }
    };

    const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        setIsDragging(true);
        updateProgress(e.clientX);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                updateProgress(e.clientX);
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, duration]);

    useEffect(() => {
        if (useModal && isModalOpen && videoRef.current) {
            const playPromise = videoRef.current.play();
            if (playPromise !== undefined) {
                playPromise.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
            }
        }
    }, [isModalOpen, useModal]);

    const togglePlay = (e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
                setIsPlaying(false);
            } else {
                if (videoRef.current.readyState < 3) {
                    setIsBuffering(true);
                }
                videoRef.current.play().catch(() => setIsPlaying(false));
                setIsPlaying(true);
            }
        }
    };

    const toggleMute = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (videoRef.current) {
            videoRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const handleThumbnailClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (useModal) {
            setIsModalOpen(true);
        } else {
            togglePlay(e);
        }
    };

    const closeModal = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (videoRef.current) {
            videoRef.current.pause();
        }
        setIsPlaying(false);
        setIsModalOpen(false);
    };

    const renderControls = () => (
        <div 
            className={`absolute bottom-0 left-0 right-0 p-4 md:p-6 bg-gradient-to-t from-black/80 to-transparent z-20 flex flex-col gap-4 transition-opacity duration-300 ${isPlaying || isDragging ? 'opacity-0 group-hover:opacity-100' : 'opacity-0'}`}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="flex justify-between items-center">
                <button 
                    onClick={togglePlay} 
                    className="w-10 h-10 md:w-12 md:h-12 bg-brand-yellow text-black flex items-center justify-center hover:bg-white hover:scale-105 transition-all shadow-lg"
                    aria-label={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? <Pause className="w-5 h-5 fill-black text-black" /> : <Play className="w-5 h-5 fill-black text-black ml-1" />}
                </button>
                <button 
                    onClick={toggleMute} 
                    className="w-10 h-10 md:w-12 md:h-12 bg-black/50 backdrop-blur text-brand-yellow border border-brand-yellow flex items-center justify-center hover:bg-brand-yellow hover:text-black transition-all shadow-lg"
                    aria-label={isMuted ? "Unmute" : "Mute"}
                >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
            </div>
            <div className="flex items-center gap-3 text-white font-mono text-[10px] md:text-xs">
                <span>{formatTime(progress)}</span>
                <div 
                    ref={progressBarRef}
                    className="flex-1 h-2 md:h-3 cursor-pointer relative group/progress flex items-center py-2"
                    onMouseDown={handleProgressMouseDown}
                >
                    <div className="absolute left-0 right-0 h-1 md:h-1.5 bg-white/20 pointer-events-none" />
                    <div 
                        className="absolute left-0 h-1 md:h-1.5 bg-brand-yellow pointer-events-none" 
                        style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%` }} 
                    />
                    <div 
                        className="absolute w-3 h-3 md:w-4 md:h-4 bg-white rounded-full pointer-events-none opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-sm"
                        style={{ left: `calc(${duration > 0 ? (progress / duration) * 100 : 0}% - 6px)` }}
                    />
                </div>
                <span>{formatTime(duration)}</span>
            </div>
        </div>
    );

    const renderLoading = () => (
        isBuffering && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 pointer-events-none transition-opacity duration-300">
                <div className="grid grid-cols-3 gap-1 p-3 bg-black/60 backdrop-blur-md border border-gray-800">
                    {[...Array(9)].map((_, i) => (
                        <motion.div
                            key={i}
                            className="bg-brand-yellow w-2.5 h-2.5 md:w-3 md:h-3"
                            animate={{ opacity: [0.1, 1, 0.1], scale: [0.8, 1, 0.8] }}
                            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.1, ease: "easeInOut" }}
                        />
                    ))}
                </div>
            </div>
        )
    );

    return (
        <>
            <motion.div 
                layoutId={useModal ? `video-container-${layoutId}` : undefined}
                className={`relative overflow-hidden bg-gray-100 group cursor-pointer ${className}`} 
                onClick={handleThumbnailClick}
            >
                {!isPlaying && !isHero && (
                    <div className="absolute inset-0 bg-brand-purple/90 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 flex items-center justify-center pointer-events-none">
                        <span className="bg-brand-yellow text-black font-display font-bold px-6 py-3 uppercase text-sm tracking-widest flex items-center gap-2">
                            Play Video <Play className="w-4 h-4 fill-black text-black" />
                        </span>
                    </div>
                )}
                {!isPlaying && isHero && (
                    <div className="absolute bottom-6 left-6 md:bottom-12 md:left-12 aspect-square w-16 md:w-24 bg-brand-yellow flex items-center justify-center group-hover:scale-110 transition-transform cursor-pointer shadow-lg z-10 pointer-events-none">
                        <Play className="fill-black text-black w-6 h-6 md:w-10 md:h-10 ml-1" />
                    </div>
                )}
                
                {useModal ? (
                    <img 
                        src={project.img} 
                        alt={project.title} 
                        className="w-full h-full object-cover transition-transform duration-700 ease-out grayscale opacity-90 group-hover:scale-105" 
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    <>
                        {renderControls()}
                        {renderLoading()}
                        <video 
                            ref={videoRef}
                            src={project.video}
                            poster={project.img}
                            className={`w-full h-full object-cover transition-transform duration-700 ease-out ${!isPlaying ? 'grayscale opacity-90 group-hover:scale-105' : 'scale-100'}`}
                            loop
                            playsInline
                            muted={isMuted}
                            onWaiting={() => setIsBuffering(true)}
                            onPlaying={() => setIsBuffering(false)}
                            onCanPlay={() => setIsBuffering(false)}
                            onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
                            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                        />
                    </>
                )}
            </motion.div>

            <AnimatePresence>
                {useModal && isModalOpen && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 md:p-8"
                        onClick={closeModal}
                    >
                        <button 
                            onClick={closeModal} 
                            className="absolute top-4 right-4 md:top-8 md:right-8 text-brand-yellow hover:text-white hover:scale-110 transition-all z-[110] bg-brand-purple/50 md:bg-brand-purple/20 p-2 rounded-full cursor-pointer border border-brand-purple hover:border-brand-yellow hover:bg-brand-purple"
                        >
                            <X className="w-6 h-6 md:w-8 md:h-8" />
                        </button>
                        <motion.div 
                            layoutId={useModal ? `video-container-${layoutId}` : undefined}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="relative max-w-full max-h-full flex items-center justify-center group rounded-lg overflow-hidden border-2 border-brand-purple shadow-[0_0_50px_-12px_rgba(157,78,221,0.5)] hover:border-brand-yellow hover:shadow-[0_0_50px_-12px_rgba(255,200,0,0.8)] transition-all duration-500 bg-black" 
                            onClick={(e) => e.stopPropagation()}
                        >
                            {renderControls()}
                            {renderLoading()}
                            <video 
                                ref={videoRef}
                                src={project.video}
                                poster={project.img}
                                className="max-w-full max-h-[85vh] w-auto h-auto block bg-black object-contain"
                                loop
                                playsInline
                                muted={isMuted}
                                onWaiting={() => setIsBuffering(true)}
                                onPlaying={() => setIsBuffering(false)}
                                onCanPlay={() => setIsBuffering(false)}
                                onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
                                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                            />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-6 md:px-12 mix-blend-difference text-white">
      <Link to="/" className="font-display font-bold text-xl tracking-tight">PIXEL PRODUCTIONS</Link>
      
      <div className="hidden md:flex items-center space-x-12 font-sans text-xs uppercase tracking-widest">
        <a href="/#projects" className="hover:text-brand-yellow transition-colors">Projects</a>
        <a href="/#services" className="hover:text-brand-yellow transition-colors">Services</a>
        <a href="/#about" className="hover:text-brand-yellow transition-colors">About</a>
      </div>

      <div className="flex items-center space-x-4 md:space-x-6">
        <a href="#" className="hover:text-brand-yellow transition-colors" aria-label="Instagram">
          <Instagram className="w-5 h-5" />
        </a>
        <a href="#" className="hover:text-brand-yellow transition-colors" aria-label="Twitter">
          <Twitter className="w-5 h-5" />
        </a>
        <a href="#" className="hover:text-brand-yellow transition-colors" aria-label="LinkedIn">
          <Linkedin className="w-5 h-5" />
        </a>
      </div>
    </nav>
  );
};

const Hero = () => {
  return (
    <section className="relative min-h-screen pt-32 pb-20 px-6 md:px-12 max-w-[1800px] mx-auto overflow-hidden flex flex-col justify-center">
      {/* Structural Thin Lines */}
      <div className="absolute top-0 left-4 md:left-12 bottom-0 w-[1px] bg-gray-100 -z-10" />
      <div className="absolute top-32 left-0 right-0 h-[1px] bg-gray-100 -z-10" />

      {/* The bold brand name - Oversized & Staggered Reveal */}
      <motion.h1
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: {
              staggerChildren: 0.08,
              delayChildren: 0.2,
            },
          },
        }}
        className="font-display font-bold text-[15vw] md:text-[12vw] leading-[0.85] tracking-tighter uppercase z-10 relative mt-12 flex flex-col cursor-default"
      >
        <span className="overflow-hidden flex">
          {"Pixel".split("").map((char, i) => (
            <motion.span
              key={`line1-${i}`}
              variants={{
                hidden: { opacity: 0, y: "100%" },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 1.2, ease: [0.16, 1, 0.3, 1] },
                },
              }}
              className="inline-block"
            >
              {char}
            </motion.span>
          ))}
        </span>
        <span className="overflow-hidden flex items-end">
          {"Productions".split("").map((char, i) => (
            <motion.span
              key={`line2-${i}`}
              variants={{
                hidden: { opacity: 0, y: "100%" },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 1.2, ease: [0.16, 1, 0.3, 1] },
                },
              }}
              className="inline-block"
            >
              {char}
            </motion.span>
          ))}
          <motion.span
            variants={{
              hidden: { opacity: 0, scale: 0, color: "#7B2EFF" },
              visible: {
                opacity: 1,
                scale: 1,
                color: ["#7B2EFF", "#FFD600", "#7B2EFF"],
                transition: { 
                  duration: 0.8, 
                  ease: "backOut",
                  color: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }
                },
              },
            }}
            className="text-brand-purple inline-block origin-bottom"
          >
            .
          </motion.span>
        </span>
      </motion.h1>

      {/* Asymmetrical Layout for Image & Details */}
      <div className="mt-12 md:mt-24 flex flex-col xl:flex-row justify-end items-end relative w-full">
        
        {/* Abstract Purple Background Element */}
        <motion.div 
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1, ease: "circOut", delay: 0.2 }}
          className="absolute top-1/2 left-0 w-[80%] md:w-[60%] h-32 md:h-64 bg-brand-purple -translate-y-1/2 z-0 origin-left"
        />

        {/* Main Hero Media */}
        <motion.div 
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }}
           className="relative z-10 w-full md:w-4/5 lg:w-3/4 xl:w-2/3 ml-auto group"
        >
          <div className="aspect-[16/9] bg-gray-200 relative overflow-hidden">
            <ProjectVideo 
               project={{
                   video: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                   img: "https://picsum.photos/seed/cyberpunk/1920/1080?grayscale"
               }}
               className="w-full h-full"
               isHero={true}
            />
            
            {/* Overlay Info on Image */}
            <div className="absolute top-6 right-6 md:top-12 md:right-12 text-right z-20 pointer-events-none">
                <p className="font-display font-bold text-white text-xs md:text-sm tracking-widest uppercase shadow-black drop-shadow-md">Showreel</p>
                <p className="font-mono text-white/90 text-[10px] md:text-xs pt-1 drop-shadow-md">2026 // 02:45</p>
            </div>
          </div>
        </motion.div>

        {/* Brutalist Vertical Text */}
        <div className="hidden lg:block absolute left-0 bottom-12 origin-bottom-left -rotate-90 translate-x-12 translate-y-12">
          <p className="font-display text-xs tracking-[0.4em] uppercase text-gray-400">Materials of Creation</p>
        </div>
      </div>
      
      {/* Intro Description */}
      <div className="mt-16 max-w-md w-full ml-auto xl:mr-32 flex flex-col items-end text-right">
        <p className="text-black font-medium text-sm md:text-base leading-relaxed">
          Splicing reality into something way cooler. I make high quality shorts and confident long form videos that actually make people stop scrolling. Fuelled by a lotta coffee.
        </p>
        <div className="h-[1px] w-24 bg-black mt-8"></div>
      </div>
    </section>
  );
};

const Projects = () => {
  const projects = [
    { title: "Neon Nights", category: "Commercial", year: "'25", img: "https://picsum.photos/seed/neon/800/1200?grayscale", video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
    { title: "Echoes of Silence", category: "Documentary", year: "'25", img: "https://picsum.photos/seed/silence/800/1200?grayscale", video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
    { title: "Velocity", category: "Automotive", year: "'24", img: "https://picsum.photos/seed/car/1000/600?grayscale", video: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
    { title: "Vogue Subculture", category: "Fashion", year: "'24", img: "https://picsum.photos/seed/fashion/800/600?grayscale", video: "https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" },
  ];

  return (
    <section id="projects" className="py-32 px-6 md:px-12 bg-white relative">
      <div className="max-w-[1800px] mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-end mb-24 border-b border-gray-200 pb-8">
            <h2 className="font-display font-bold text-5xl md:text-7xl lg:text-9xl tracking-tighter uppercase">Selected<br/>Works.</h2>
            <p className="font-sans text-xs uppercase tracking-widest text-gray-400 mt-8 md:mt-0 max-w-[200px] text-right">A highlight reel of things I probably spent way too much time perfecting.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-y-24 gap-x-12 md:gap-x-24">
          {projects.map((project, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, delay: idx * 0.1 }}
              className={`group cursor-pointer ${
                idx === 1 ? 'md:mt-48' :
                idx === 2 ? 'md:-mt-48' : ''
              }`}
            >
              <ProjectVideo 
                 project={project} 
                 className={`${idx >= 2 ? 'aspect-video md:aspect-[16/9]' : 'aspect-[9/16]'}`} 
                 useModal={true}
              />
              
              <div className="flex justify-between items-start mt-6">
                 <div>
                     <h3 className="font-display font-bold text-2xl md:text-3xl uppercase tracking-tight">{project.title}</h3>
                     <p className="text-gray-500 text-sm mt-1 uppercase tracking-widest">{project.category}</p>
                 </div>
                 <span className="font-mono text-sm text-gray-400">{project.year}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const FeaturedWork = () => {
   const containerRef = useRef<HTMLDivElement>(null);
   const { scrollYProgress } = useScroll({
      target: containerRef,
      offset: ["start end", "end start"]
   });

   const y = useTransform(scrollYProgress, [0, 1], ["-10%", "10%"]);

   return (
      <section id="about" ref={containerRef} className="py-32 px-6 md:px-12 bg-[#0a0a0a] text-white relative overflow-hidden">
         <div className="max-w-[1800px] mx-auto relative z-10">
             <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
                 
                 <div className="lg:col-span-4 flex flex-col">
                     <p className="font-display text-brand-yellow text-xs uppercase tracking-[0.3em] font-bold mb-4">Spotlight</p>
                     <h2 className="font-display font-bold text-6xl md:text-7xl xl:text-8xl tracking-tight uppercase leading-none mb-8">
                         The <br/><span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-purple to-purple-400">Void</span>
                     </h2>
                     <p className="text-gray-400 text-sm leading-relaxed max-w-sm mb-12">
                         Getting a little weird with time and space. Think aggressive jump cuts meets buttery smooth speed ramps. Don't try this at home.
                     </p>
                     <button className="flex items-center gap-4 text-brand-yellow hover:text-white transition-colors uppercase tracking-widest text-xs font-bold w-fit pb-2 border-b border-brand-yellow hover:border-white">
                         Watch Full Case Study <ArrowRight className="w-4 h-4" />
                     </button>
                 </div>

                 <div className="lg:col-span-8 relative">
                     {/* Decorative Elements */}
                     <div className="absolute -top-12 -right-12 w-64 h-64 bg-brand-purple blur-[100px] opacity-30 rounded-full" />
                     
                     <motion.div style={{ y }} className="relative bg-gray-900 border border-gray-800 p-2 md:p-4">
                         <ProjectVideo 
                            project={{
                               title: "The Void", 
                               img: "https://picsum.photos/seed/void/1200/800?grayscale",
                               video: "https://storage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4"
                            }} 
                            className="w-full aspect-[16/9]" 
                         />
                         
                         {/* Floating Data Blocks */}
                         <div className="absolute -bottom-8 -left-4 md:-left-12 bg-white text-black p-6 border border-gray-200 shadow-2xl hidden md:block">
                             <p className="font-mono text-xs text-gray-500 mb-1">Color Grade</p>
                             <p className="font-display font-bold text-lg uppercase">Davinci / RBL</p>
                         </div>
                     </motion.div>
                 </div>

             </div>
         </div>
      </section>
   )
}

const Services = () => {
  const services = [
    { id: 'short-form', num: '01', title: 'Short Form\nEditing', desc: 'Bite-sized bangers designed to hijack attention spans and break the algorithm.' },
    { id: 'long-form', num: '02', title: 'Long Form\nEditing', desc: 'Sticking the totally-not-boring pieces together for documentaries, essays, and films that actually slaps.' },
    { id: 'motion-design', num: '03', title: 'Motion\nDesign', desc: 'Making words dance and adding those sneaky VFX tweaks you didn\'t even know you needed.' },
  ];

  return (
    <section id="services" className="py-32 px-6 md:px-12 max-w-[1800px] mx-auto bg-white">
      <div className="border-t border-black pt-12 flex flex-col lg:flex-row justify-between lg:items-start gap-16">
        
        <div className="lg:w-1/3">
          <h2 className="font-display font-bold text-4xl md:text-5xl uppercase tracking-tighter">Capabilities.</h2>
          <p className="mt-6 text-gray-500 text-sm leading-relaxed max-w-xs">
              Making your footage look 100x better. No magic wands, just a ridiculous amount of keyframes.
          </p>
        </div>

        <div className="lg:w-2/3 flex flex-col w-full">
          {services.map((service, idx) => (
             <Link 
                key={idx}
                to={`/service/${service.id}`}
                className="group flex flex-col md:flex-row border-b border-gray-200 py-8 md:py-12 items-start md:items-center hover:bg-gray-50 transition-colors px-4 -mx-4 cursor-pointer relative"
             >
                 <div className="flex gap-4 md:gap-8 items-baseline md:w-[55%] shrink-0">
                     <span className="font-mono text-brand-purple font-bold text-sm shrink-0">{service.num}</span>
                     <h3 className="font-display font-bold text-4xl md:text-5xl xl:text-7xl leading-[0.85] uppercase tracking-tighter group-hover:text-brand-purple transition-colors whitespace-pre-line">{service.title}</h3>
                 </div>
                 
                 <div className="mt-4 md:mt-0 flex items-center justify-between w-full md:w-[45%] gap-6 xl:gap-12 md:pl-8">
                     <p className="text-gray-500 text-sm max-w-[280px] hidden md:block">{service.desc}</p>
                     
                     <div className="w-12 h-12 shrink-0 rounded-full border border-gray-300 flex items-center justify-center group-hover:bg-brand-yellow group-hover:border-brand-yellow transition-all ml-auto md:ml-0">
                         <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-black transform group-hover:-rotate-45 transition-all" />
                     </div>
                 </div>
             </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

const Contact = () => {
    return (
        <section className="bg-brand-purple relative overflow-hidden text-white mt-12 py-32 px-6 md:px-12 flex flex-col items-center justify-center min-h-[60vh] text-center">
            {/* Background Texture/glow */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent opacity-50 blur-2xl"></div>
            
            <div className="relative z-10 w-full max-w-[1200px]">
                <p className="font-mono text-brand-yellow uppercase tracking-widest text-sm mb-6">Available for bookings '26</p>
                <h2 className="font-display font-bold text-[10vw] leading-none tracking-tighter uppercase mb-12 mix-blend-overlay">
                    Let's Build.
                </h2>
                
                <a href="mailto:hello@pixelproductions.com" className="inline-flex items-center gap-4 bg-brand-yellow text-black px-8 py-5 font-bold uppercase tracking-widest text-sm hover:scale-105 transition-transform hover:shadow-[0_0_40px_rgba(255,214,0,0.4)]">
                   <Mail className="w-5 h-5" /> Start a Conversation
                </a>
            </div>
            
            <div className="absolute bottom-6 left-6 right-6 flex justify-between items-center text-[10px] font-mono tracking-widest uppercase opacity-50">
                <p>Based in TR // Working GC</p>
                <p>&copy; {new Date().getFullYear()} PIXEL PRODUCTIONS.</p>
            </div>
        </section>
    )
}

// --- PAGES ---

const ServicePage = () => {
    const { id } = useParams();
    
    // Derived Data
    const pageData: Record<string, { title: string, subtitle: string, projects: any[] }> = {
        'short-form': {
            title: 'Short Form Editing',
            subtitle: 'Bite-sized bangers designed to hijack attention spans.',
            projects: [
                { title: 'Brand X TikTok', category: 'Social Campaign', img: 'https://picsum.photos/seed/tiktok/800/1200?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
                { title: 'Creator Reels', category: 'Influencer', img: 'https://picsum.photos/seed/reels/800/1200?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
                { title: 'Promo Snippets', category: 'Commercial', img: 'https://picsum.photos/seed/promo/800/1200?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
            ]
        },
        'long-form': {
            title: 'Long Form Editing',
            subtitle: 'Sticking the totally-not-boring pieces together.',
            projects: [
                { title: 'Echoes of Silence', category: 'Documentary', img: 'https://picsum.photos/seed/silence/1000/600?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
                { title: 'The Founder', category: 'Interview Series', img: 'https://picsum.photos/seed/founder/1000/600?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" },
            ]
        },
        'motion-design': {
            title: 'Motion Design',
            subtitle: 'Making words dance and adding those sneaky VFX.',
            projects: [
                { title: 'Neon Nights Title Sequence', category: 'Typography', img: 'https://picsum.photos/seed/neon/800/600?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
                { title: 'Future Tech Explainer', category: '3D & 2D Motion', img: 'https://picsum.photos/seed/tech/800/600?grayscale', video: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
            ]
        }
    };

    const data = pageData[id || 'short-form'];

    // Scroll to top automatically when loading
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [id]);

    if (!data) return <div className="min-h-screen pt-48 px-12">Service Info not found.</div>;

    return (
        <div className="pt-32 pb-20 px-6 md:px-12 max-w-[1800px] mx-auto min-h-screen">
            <Link to="/#services" className="inline-flex items-center gap-2 text-sm uppercase tracking-widest font-bold hover:text-brand-purple transition-colors mb-12">
                <ArrowLeft className="w-4 h-4" /> Back to Home
            </Link>
            
            <h1 className="font-display font-bold text-6xl md:text-8xl lg:text-[10vw] uppercase tracking-tighter leading-none mb-6">{data.title}</h1>
            <p className="text-xl md:text-2xl text-gray-400 font-medium max-w-2xl mb-24">{data.subtitle}</p>

            <h2 className="font-display font-bold text-3xl uppercase tracking-widest border-b border-gray-200 pb-4 mb-12">Related Projects</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24">
               {data.projects.map((project, idx) => (
                   <motion.div 
                     key={idx}
                     initial={{ opacity: 0, y: 50 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.6, delay: idx * 0.1 }}
                     className="group cursor-pointer"
                   >
                     <ProjectVideo project={project} className="aspect-video md:aspect-[4/5]" useModal={true} />
                     <div className="flex justify-between items-start mt-6">
                        <div>
                            <h3 className="font-display font-bold text-2xl uppercase tracking-tight">{project.title}</h3>
                            <p className="text-gray-500 text-xs mt-1 uppercase tracking-widest">{project.category}</p>
                        </div>
                     </div>
                   </motion.div>
               ))}
            </div>
        </div>
    )
}

const Home = () => {
    return (
        <main>
            <Hero />
            <Projects />
            <FeaturedWork />
            <Services />
        </main>
    )
}

// --- MAIN APP COMPONENT ---

export default function App() {
  const { pathname } = useLocation();

  // Ensure every time the page loads (or route changes), it starts at the top
  // and removes any stored hash from the URL
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      
      <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/service/:id" element={<ServicePage />} />
      </Routes>
      
      <Contact />
    </div>
  );
}
